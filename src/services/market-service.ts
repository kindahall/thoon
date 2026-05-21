import type { Candle, MarketDataSnapshot, MarketPair, Timeframe } from '../types/market';
import { getBudCandles, getBudTicker, normalizeBudSymbol, type BudCandle, type BudTicker24h } from '../server/bud-backend-client';
import { getBinanceMarketCandles, getBinanceMarketDataSnapshot } from '../server/exchanges/binance-market-data';
import { getPublicRestMarketCandles } from '../server/exchanges/public-rest-market-data';
import { getThoonServerEnv } from '../server/env';
import { readThoonDb } from '../server/thoon-db';
import { sanitizeCandles } from '../utils/candles';

type MarketDataType = 'futures' | 'perpetual' | 'spot';

export async function getMarketDataSnapshot(): Promise<MarketDataSnapshot> {
  const db = readThoonDb();
  const env = getThoonServerEnv();

  if (env.marketDataProvider === 'bud') {
    return getBudMarketDataSnapshot(db.marketPairRecords, db.marketOverviewRecord);
  }

  return getBinanceMarketDataSnapshot(db.marketPairRecords, db.marketOverviewRecord);
}

export async function listMarketPairs(): Promise<MarketPair[]> {
  return (await getMarketDataSnapshot()).pairs;
}

export function listBootstrapMarketPairs(): MarketPair[] {
  return readThoonDb().marketPairRecords;
}

export async function getPrimaryMarket(): Promise<MarketPair> {
  return (await listMarketPairs())[0];
}

export async function findMarketPair(symbol: string): Promise<MarketPair | undefined> {
  return (await listMarketPairs()).find((pair) => pair.symbol === symbol);
}

export async function getMarketOverview() {
  return (await getMarketDataSnapshot()).overview;
}

export async function getMarketCandles(symbol: string, timeframe: Timeframe, exchangeId = 'binance', requestedLimit?: number, options: { marketType?: MarketDataType; strict?: boolean } = {}): Promise<Candle[]> {
  const db = readThoonDb();
  const env = getThoonServerEnv();

  if (env.marketDataProvider === 'bud' && exchangeId === 'binance') {
    return sanitizeCandles(await getBudMarketCandles(symbol, timeframe, requestedLimit, options));
  }

  if (exchangeId !== 'binance') {
    return sanitizeCandles(await getPublicRestMarketCandles(db.marketPairRecords, symbol, timeframe, exchangeId, requestedLimit, options));
  }

  return sanitizeCandles(await getBinanceMarketCandles(db.marketPairRecords, symbol, timeframe, requestedLimit, options));
}

async function getBudMarketDataSnapshot(seedPairs: MarketPair[], seedOverview: MarketDataSnapshot['overview']): Promise<MarketDataSnapshot> {
  const env = getThoonServerEnv();
  const results = await Promise.allSettled(
    seedPairs.map(async (pair) => {
      const ticker = await getBudTicker(pair.symbol);
      return applyBudTicker(pair, ticker);
    }),
  );
  const warnings: string[] = [];
  const livePairCount = results.filter((result) => result.status === 'fulfilled').length;
  const pairs = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    warnings.push(`${seedPairs[index].symbol}: ${result.reason instanceof Error ? result.reason.message : 'Bud ticker unavailable'}`);
    return seedPairs[index];
  });

  return {
    overview: buildBudOverview(seedOverview, pairs),
    pairs,
    status: {
      baseUrl: env.budBackendUrl,
      live: livePairCount > 0,
      pairCount: livePairCount,
      provider: 'bud',
      updatedAt: new Date().toISOString(),
      warnings,
    },
  };
}

async function getBudMarketCandles(symbol: string, timeframe: Timeframe, requestedLimit?: number, options: { strict?: boolean } = {}) {
  try {
    const candles = await getBudCandles(symbol, toBudInterval(timeframe), requestedLimit ?? 300);
    return candles.map(fromBudCandle);
  } catch (error) {
    if (options.strict) {
      throw error;
    }

    const pair = readThoonDb().marketPairRecords.find((item) => item.symbol === symbol);
    if (!pair) {
      throw error;
    }

    return pair.candles;
  }
}

function applyBudTicker(pair: MarketPair, ticker: BudTicker24h): MarketPair {
  const price = ticker.last_price;
  const previousPrice = pair.lastPrice > 0 ? pair.lastPrice : price;
  const priceRatio = previousPrice > 0 ? price / previousPrice : 1;
  const fallbackStop = pair.draft.direction === 'long' ? price * 0.98 : price * 1.02;
  const fallbackTakeProfit = pair.draft.direction === 'long' ? price * 1.04 : price * 0.96;

  return {
    ...pair,
    change24h: ticker.price_change_percent,
    exchange: 'Bud/Binance',
    lastPrice: price,
    marketCap: pair.marketCap * priceRatio,
    volume24h: ticker.quote_volume,
    draft: {
      ...pair.draft,
      entry: price,
      stopLoss: pair.draft.stopLoss > 0 ? pair.draft.stopLoss * priceRatio : fallbackStop,
      takeProfit: pair.draft.takeProfit > 0 ? pair.draft.takeProfit * priceRatio : fallbackTakeProfit,
    },
  };
}

function buildBudOverview(seedOverview: MarketDataSnapshot['overview'], pairs: MarketPair[]) {
  const marketCap = pairs.reduce((sum, pair) => sum + pair.marketCap, 0);
  const volume24h = pairs.reduce((sum, pair) => sum + pair.volume24h, 0);
  const btc = pairs.find((pair) => normalizeBudSymbol(pair.symbol) === 'BTCUSDT');
  const eth = pairs.find((pair) => normalizeBudSymbol(pair.symbol) === 'ETHUSDT');

  return {
    ...seedOverview,
    btcDominance: btc && marketCap ? (btc.marketCap / marketCap) * 100 : seedOverview.btcDominance,
    ethDominance: eth && marketCap ? (eth.marketCap / marketCap) * 100 : seedOverview.ethDominance,
    marketCap: marketCap || seedOverview.marketCap,
    sentiment: pairs.filter((pair) => pair.change24h >= 0).length >= pairs.length / 2 ? 'Risk-on' : 'Risk-off',
    volume24h: volume24h || seedOverview.volume24h,
  };
}

function fromBudCandle(candle: BudCandle): Candle {
  return {
    close: candle.close,
    high: candle.high,
    low: candle.low,
    open: candle.open,
    time: Math.floor(candle.timestamp / 1000),
    volume: candle.volume,
  };
}

function toBudInterval(timeframe: Timeframe) {
  if (timeframe === '1y') {
    return '1d';
  }

  return timeframe;
}
