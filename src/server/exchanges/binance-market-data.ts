import type { Candle, MarketDataSnapshot, MarketOverview, MarketPair, Timeframe } from '../../types/market';
import { getThoonServerEnv } from '../env';

type BinanceTicker = {
  closeTime: number;
  highPrice: string;
  lastPrice: string;
  lowPrice: string;
  openPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  symbol: string;
  volume: string;
};

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

type BinanceFuturesExchangeInfo = {
  symbols?: Array<{
    contractType?: string;
    onboardDate?: number;
    quoteAsset?: string;
    status?: string;
    symbol: string;
  }>;
};

type BinanceMarketType = 'futures' | 'perpetual' | 'spot';

type BinanceCandleOptions = {
  marketType?: BinanceMarketType;
  strict?: boolean;
};

const timeframeIntervals: Record<Timeframe, string> = {
  '1M': '1M',
  '1d': '1d',
  '1h': '1h',
  '1m': '1m',
  '1w': '1w',
  '1y': '1M',
  '2h': '2h',
  '30m': '30m',
  '4h': '4h',
  '5m': '5m',
  '15m': '15m',
};

const maxBinanceKlinePageSize = 1000;
const livePairLimit = 100;
const minimumAgentListingAgeMs = 45 * 24 * 60 * 60 * 1000;

const symbolAliases: Record<string, string> = {
  'RNDR/USDT': 'RENDERUSDT',
};

let cachedSnapshot: { expiresAt: number; snapshot: MarketDataSnapshot } | undefined;

export async function getBinanceMarketDataSnapshot(seedPairs: MarketPair[], seedOverview: MarketOverview): Promise<MarketDataSnapshot> {
  const env = getThoonServerEnv();

  if (env.marketDataProvider === 'local') {
    return localSnapshot(seedPairs, seedOverview, env.binanceMarketBaseUrl, ['Market data provider is set to local.']);
  }

  const now = Date.now();

  if (cachedSnapshot && cachedSnapshot.expiresAt > now) {
    return cachedSnapshot.snapshot;
  }

  try {
    const [tickers, exchangeInfo] = await Promise.all([
      fetchBinanceJson<BinanceTicker[]>('/fapi/v1/ticker/24hr', {}, 'perpetual'),
      fetchBinanceJson<BinanceFuturesExchangeInfo>('/fapi/v1/exchangeInfo', {}, 'perpetual'),
    ]);
    const tradableFuturesSymbols = buildTradableFuturesSymbolSet(exchangeInfo);
    const tickerMap = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
    const livePairs = buildLivePairsWithBinance(seedPairs, tickers, tradableFuturesSymbols);
    const enrichedPairs = await enrichPairsWithBinance(livePairs, tickerMap);
    const overview = buildOverview(seedOverview, enrichedPairs);
    const warnings = seedPairs
      .filter((pair) => !tradableFuturesSymbols.has(toBinanceSymbol(pair.symbol)))
      .map((pair) => `${pair.symbol} is not an active Binance USDT perpetual with enough listing history for the agent matrix.`);
    const snapshot: MarketDataSnapshot = {
      overview,
      pairs: enrichedPairs,
      status: {
        baseUrl: env.binanceFuturesMarketBaseUrl,
        live: true,
        pairCount: enrichedPairs.filter((pair) => pair.exchange === 'Binance').length,
        provider: 'binance',
        updatedAt: new Date().toISOString(),
        warnings,
      },
    };

    cachedSnapshot = {
      expiresAt: now + env.marketRefreshSeconds * 1000,
      snapshot,
    };

    return snapshot;
  } catch (error) {
    return localSnapshot(seedPairs, seedOverview, env.binanceMarketBaseUrl, [error instanceof Error ? error.message : 'Binance market data unavailable.']);
  }
}

export async function getBinanceMarketCandles(seedPairs: MarketPair[], symbol: string, timeframe: Timeframe, requestedLimit?: number, options: BinanceCandleOptions = {}): Promise<Candle[]> {
  const env = getThoonServerEnv();
  const pair = seedPairs.find((item) => item.symbol === symbol) ?? createLivePairShell(symbol);
  const marketType = normalizeBinanceMarketType(options.marketType);

  if (!pair) {
    return [];
  }

  if (env.marketDataProvider === 'local') {
    if (options.strict) {
      throw new Error('Live Binance candles are required for backtesting; THOON_MARKET_DATA_PROVIDER is local.');
    }

    return deriveFallbackCandles(pair.candles, timeframe);
  }

  if (options.strict) {
    return fetchCandles(pair, toBinanceSymbol(pair.symbol), timeframe, requestedLimit, { marketType, strict: true });
  }

  return fetchCandles(pair, toBinanceSymbol(pair.symbol), timeframe, requestedLimit, { marketType }).catch(() => deriveFallbackCandles(pair.candles, timeframe));
}

async function enrichPairsWithBinance(seedPairs: MarketPair[], tickerMap: Map<string, BinanceTicker>) {
  const pairResults = await Promise.allSettled(
    seedPairs.map(async (pair) => {
      const binanceSymbol = toBinanceSymbol(pair.symbol);
      const ticker = tickerMap.get(binanceSymbol);

      if (!ticker) {
        return pair;
      }

      const lastPrice = asMarketNumber(ticker.lastPrice, pair.lastPrice);
      const marketCap = pair.marketCap && pair.lastPrice ? pair.marketCap * (lastPrice / pair.lastPrice) : pair.marketCap;
      const stopRatio = pair.draft.stopLoss / pair.lastPrice;
      const takeProfitRatio = pair.draft.takeProfit / pair.lastPrice;

      return {
        ...pair,
        change24h: asMarketNumber(ticker.priceChangePercent, pair.change24h),
        exchange: 'Binance',
        lastPrice,
        marketCap,
        volume24h: asMarketNumber(ticker.quoteVolume, pair.volume24h),
        draft: {
          ...pair.draft,
          entry: lastPrice,
          stopLoss: roundMarketValue(lastPrice * stopRatio),
          takeProfit: roundMarketValue(lastPrice * takeProfitRatio),
        },
      };
    }),
  );

  return pairResults.map((result, index) => (result.status === 'fulfilled' ? result.value : seedPairs[index]));
}

function buildLivePairsWithBinance(seedPairs: MarketPair[], tickers: BinanceTicker[], tradableFuturesSymbols: Set<string>) {
  const seedBySymbol = new Map(seedPairs.map((pair) => [pair.symbol, pair]));
  const pairs = tickers
    .filter((ticker) => tradableFuturesSymbols.has(ticker.symbol) && isUsdtCryptoTicker(ticker))
    .sort((left, right) => asMarketNumber(right.quoteVolume, 0) - asMarketNumber(left.quoteVolume, 0))
    .slice(0, livePairLimit)
    .map((ticker) => {
      const symbol = fromBinanceSymbol(ticker.symbol);
      const seedPair = seedBySymbol.get(symbol);

      if (seedPair) {
        return seedPair;
      }

      return createLivePairShell(symbol, ticker);
    });

  return pairs.filter((pair): pair is MarketPair => Boolean(pair));
}

function buildTradableFuturesSymbolSet(exchangeInfo: BinanceFuturesExchangeInfo) {
  const now = Date.now();

  return new Set(
    (exchangeInfo.symbols ?? [])
      .filter((symbol) => symbol.quoteAsset === 'USDT')
      .filter((symbol) => symbol.status === 'TRADING')
      .filter((symbol) => !symbol.contractType || symbol.contractType === 'PERPETUAL')
      .filter((symbol) => !symbol.onboardDate || now - symbol.onboardDate >= minimumAgentListingAgeMs)
      .map((symbol) => symbol.symbol),
  );
}

function isUsdtCryptoTicker(ticker: BinanceTicker) {
  if (!ticker.symbol.endsWith('USDT')) {
    return false;
  }

  const base = ticker.symbol.slice(0, -4);
  const excludedBases = new Set(['BUSD', 'DAI', 'EUR', 'FDUSD', 'TUSD', 'USDC', 'USDE', 'USDP']);
  const leveragedSuffixes = ['BEAR', 'BULL', 'DOWN', 'UP'];

  return (
    !excludedBases.has(base) &&
    !leveragedSuffixes.some((suffix) => base.endsWith(suffix)) &&
    asMarketNumber(ticker.lastPrice, 0) > 0 &&
    asMarketNumber(ticker.quoteVolume, 0) > 0
  );
}

function createLivePairShell(symbol: string, ticker?: BinanceTicker): MarketPair | undefined {
  const [base, quote = 'USDT'] = symbol.split('/');

  if (!base || quote !== 'USDT') {
    return undefined;
  }

  const lastPrice = ticker ? asMarketNumber(ticker.lastPrice, 0) : 0;
  const stopLoss = lastPrice ? roundMarketValue(lastPrice * 0.98) : 0;
  const takeProfit = lastPrice ? roundMarketValue(lastPrice * 1.04) : 0;

  return {
    base,
    candles: [],
    category: categoryForBase(base),
    change24h: ticker ? asMarketNumber(ticker.priceChangePercent, 0) : 0,
    draft: {
      direction: 'long',
      entry: lastPrice,
      riskPercent: 1,
      size: 0,
      stopLoss,
      takeProfit,
    },
    exchange: 'Binance',
    id: slug(symbol),
    lastPrice,
    marketCap: 0,
    name: base,
    quote,
    status: 'paper',
    symbol,
    timeframe: '15m',
    volume24h: ticker ? asMarketNumber(ticker.quoteVolume, 0) : 0,
  };
}

function categoryForBase(base: string): MarketPair['category'] {
  if (['AAVE', 'CAKE', 'CRV', 'ENA', 'LINK', 'UNI'].includes(base)) {
    return 'defi';
  }

  if (['ADA', 'AVAX', 'BNB', 'ETH', 'NEAR', 'SOL', 'SUI', 'TRX', 'XRP'].includes(base)) {
    return 'layer-1';
  }

  if (['BONK', 'DOGE', 'FLOKI', 'PEPE', 'SHIB', 'WIF'].includes(base)) {
    return 'meme';
  }

  if (['AI', 'FET', 'ICP', 'INJ', 'NEAR', 'RENDER', 'TAO', 'WLD'].includes(base)) {
    return 'ai';
  }

  return 'trending';
}

async function fetchCandles(pair: MarketPair, binanceSymbol: string, timeframe: Timeframe, requestedLimit?: number, options: BinanceCandleOptions = {}): Promise<Candle[]> {
  const { marketKlineLimit } = getThoonServerEnv();
  const interval = timeframeIntervals[timeframe] ?? '15m';
  const limit = Math.max(1, Math.floor(requestedLimit ?? marketKlineLimit));
  const pages: BinanceKline[][] = [];
  let remaining = limit;
  let endTime: number | undefined;

  while (remaining > 0 && pages.length < 12) {
    const pageLimit = Math.min(maxBinanceKlinePageSize, remaining);
    const params: Record<string, string> = {
      interval,
      limit: String(pageLimit),
      symbol: binanceSymbol,
    };

    if (endTime) {
      params.endTime = String(endTime);
    }

    const page = await fetchBinanceJson<BinanceKline[]>(binanceKlinePath(options.marketType), params, options.marketType);

    if (!page.length) {
      break;
    }

    pages.unshift(page);
    remaining -= page.length;
    endTime = page[0][0] - 1;

    if (page.length < pageLimit) {
      break;
    }
  }

  const candles = pages.flat().map((kline) => ({
    close: marketNumber(kline[4], pair.lastPrice, 'close', options.strict),
    high: marketNumber(kline[2], pair.lastPrice, 'high', options.strict),
    low: marketNumber(kline[3], pair.lastPrice, 'low', options.strict),
    open: marketNumber(kline[1], pair.lastPrice, 'open', options.strict),
    time: Math.floor(kline[0] / 1000),
    volume: marketNumber(kline[5], 0, 'volume', options.strict),
  }));

  return timeframe === '1y' ? aggregateCandles(candles, 12) : candles;
}

async function fetchBinanceJson<T>(path: string, params: Record<string, string> = {}, marketType: BinanceMarketType = 'spot'): Promise<T> {
  const { binanceFuturesMarketBaseUrl, binanceMarketBaseUrl } = getThoonServerEnv();
  const baseUrl = normalizeBinanceMarketType(marketType) === 'spot' ? binanceMarketBaseUrl : binanceFuturesMarketBaseUrl;
  const url = new URL(path, baseUrl);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Binance ${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function binanceKlinePath(marketType: BinanceMarketType | undefined) {
  return normalizeBinanceMarketType(marketType) === 'spot' ? '/api/v3/klines' : '/fapi/v1/klines';
}

function normalizeBinanceMarketType(marketType: BinanceMarketType | undefined): BinanceMarketType {
  return marketType === 'perpetual' || marketType === 'futures' ? 'perpetual' : 'spot';
}

function buildOverview(seedOverview: MarketOverview, pairs: MarketPair[]): MarketOverview {
  const volume24h = pairs.reduce((sum, pair) => sum + pair.volume24h, 0);
  const marketCap = pairs.reduce((sum, pair) => sum + pair.marketCap, 0);
  const btc = pairs.find((pair) => pair.base === 'BTC');
  const eth = pairs.find((pair) => pair.base === 'ETH');

  return {
    ...seedOverview,
    btcDominance: btc && marketCap ? (btc.marketCap / marketCap) * 100 : seedOverview.btcDominance,
    ethDominance: eth && marketCap ? (eth.marketCap / marketCap) * 100 : seedOverview.ethDominance,
    marketCap,
    sentiment: pairs.filter((pair) => pair.change24h >= 0).length >= pairs.length / 2 ? 'Risk-on' : 'Risk-off',
    volume24h,
  };
}

function localSnapshot(seedPairs: MarketPair[], seedOverview: MarketOverview, baseUrl: string, warnings: string[]): MarketDataSnapshot {
  return {
    overview: seedOverview,
    pairs: seedPairs,
    status: {
      baseUrl,
      live: false,
      pairCount: seedPairs.length,
      provider: 'local',
      updatedAt: new Date().toISOString(),
      warnings,
    },
  };
}

function toBinanceSymbol(symbol: string) {
  return symbolAliases[symbol] ?? symbol.replace('/', '').toUpperCase();
}

function fromBinanceSymbol(symbol: string) {
  const alias = Object.entries(symbolAliases).find(([, binanceSymbol]) => binanceSymbol === symbol);

  if (alias) {
    return alias[0];
  }

  return `${symbol.slice(0, -4)}/USDT`;
}

function asMarketNumber(value: string, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function marketNumber(value: string, fallback: number, label: string, strict = false) {
  const parsed = Number(value);

  if (Number.isFinite(parsed) && (!strict || label === 'volume' || parsed > 0)) {
    return parsed;
  }

  if (strict) {
    throw new Error(`Invalid Binance candle ${label}: ${value}`);
  }

  return fallback;
}

function deriveFallbackCandles(candles: Candle[], timeframe: Timeframe) {
  if (timeframe === '30m') {
    return aggregateCandles(candles, 2);
  }

  if (timeframe === '1h') {
    return aggregateCandles(candles, 4);
  }

  if (timeframe === '2h') {
    return aggregateCandles(candles, 8);
  }

  if (timeframe === '4h') {
    return aggregateCandles(candles, 16);
  }

  if (timeframe === '1d') {
    return aggregateCandles(candles, 96);
  }

  if (timeframe === '1w') {
    return aggregateCandles(candles, 96 * 7);
  }

  if (timeframe === '1M') {
    return aggregateCandles(candles, 96 * 30);
  }

  if (timeframe === '1y') {
    return aggregateCandles(candles, 96 * 365);
  }

  return candles;
}

function aggregateCandles(candles: Candle[], groupSize: number) {
  if (groupSize <= 1 || candles.length <= groupSize) {
    return candles;
  }

  const aggregated: Candle[] = [];

  for (let index = 0; index < candles.length; index += groupSize) {
    const group = candles.slice(index, index + groupSize);
    const first = group[0];
    const last = group[group.length - 1];

    if (!first || !last) {
      continue;
    }

    aggregated.push({
      close: last.close,
      high: Math.max(...group.map((candle) => candle.high)),
      low: Math.min(...group.map((candle) => candle.low)),
      open: first.open,
      time: first.time,
      volume: group.reduce((sum, candle) => sum + candle.volume, 0),
    });
  }

  return aggregated;
}

function roundMarketValue(value: number) {
  if (value >= 1000) {
    return Math.round(value * 10) / 10;
  }

  if (value >= 1) {
    return Math.round(value * 1000) / 1000;
  }

  return Math.round(value * 100000) / 100000;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'market';
}
