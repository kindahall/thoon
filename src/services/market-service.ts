import type { Candle, MarketDataSnapshot, MarketPair, Timeframe } from '../types/market';
import { getBinanceMarketCandles, getBinanceMarketDataSnapshot } from '../server/exchanges/binance-market-data';
import { getPublicRestMarketCandles } from '../server/exchanges/public-rest-market-data';
import { readThoonDb } from '../server/thoon-db';

export async function getMarketDataSnapshot(): Promise<MarketDataSnapshot> {
  const db = readThoonDb();

  return getBinanceMarketDataSnapshot(db.marketPairRecords, db.marketOverviewRecord);
}

export async function listMarketPairs(): Promise<MarketPair[]> {
  return (await getMarketDataSnapshot()).pairs;
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

export async function getMarketCandles(symbol: string, timeframe: Timeframe, exchangeId = 'binance', requestedLimit?: number, options: { strict?: boolean } = {}): Promise<Candle[]> {
  const db = readThoonDb();

  if (exchangeId !== 'binance') {
    return getPublicRestMarketCandles(db.marketPairRecords, symbol, timeframe, exchangeId);
  }

  return getBinanceMarketCandles(db.marketPairRecords, symbol, timeframe, requestedLimit, options);
}
