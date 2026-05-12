import type { Candle, MarketPair, Timeframe } from '../../types/market';
import { getThoonServerEnv } from '../env';

type BybitKlineResponse = {
  retCode: number;
  retMsg: string;
  result?: {
    list?: Array<[string, string, string, string, string, string, string]>;
  };
};

const bybitIntervals: Record<Timeframe, string> = {
  '1M': 'M',
  '1d': 'D',
  '1h': '60',
  '1m': '1',
  '1w': 'W',
  '1y': 'M',
  '2h': '120',
  '30m': '30',
  '4h': '240',
  '5m': '5',
  '15m': '15',
};

type BybitCandleOptions = {
  marketType?: 'futures' | 'perpetual' | 'spot';
  strict?: boolean;
};

export async function getBybitMarketCandles(seedPairs: MarketPair[], symbol: string, timeframe: Timeframe, requestedLimit?: number, options: BybitCandleOptions = {}): Promise<Candle[]> {
  const pair = seedPairs.find((item) => item.symbol === symbol);

  if (!pair) {
    return [];
  }

  if (options.strict) {
    return fetchCandles(pair, toBybitSymbol(symbol), timeframe, requestedLimit, options);
  }

  return fetchCandles(pair, toBybitSymbol(symbol), timeframe, requestedLimit, options).catch(() => []);
}

async function fetchCandles(pair: MarketPair, symbol: string, timeframe: Timeframe, requestedLimit?: number, options: BybitCandleOptions = {}): Promise<Candle[]> {
  const { marketKlineLimit } = getThoonServerEnv();
  const response = await fetchBybitJson<BybitKlineResponse>('/v5/market/kline', {
    category: options.marketType === 'spot' ? 'spot' : 'linear',
    interval: bybitIntervals[timeframe] ?? '15',
    limit: String(Math.max(1, Math.floor(requestedLimit ?? marketKlineLimit))),
    symbol,
  });

  if (response.retCode !== 0 || !response.result?.list) {
    throw new Error(`Bybit kline failed: ${response.retMsg || response.retCode}`);
  }

  const candles = response.result.list
    .map((kline) => ({
      close: marketNumber(kline[4], pair.lastPrice, 'close', options.strict),
      high: marketNumber(kline[2], pair.lastPrice, 'high', options.strict),
      low: marketNumber(kline[3], pair.lastPrice, 'low', options.strict),
      open: marketNumber(kline[1], pair.lastPrice, 'open', options.strict),
      time: Math.floor(marketNumber(kline[0], 0, 'time', options.strict) / 1000),
      volume: marketNumber(kline[5], 0, 'volume', options.strict),
    }))
    .reverse();

  return timeframe === '1y' ? aggregateCandles(candles, 12) : candles;
}

async function fetchBybitJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const { bybitMarketBaseUrl } = getThoonServerEnv();
  const url = new URL(path, bybitMarketBaseUrl);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Bybit ${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function toBybitSymbol(symbol: string) {
  return symbol.replace('/', '').toUpperCase();
}

function marketNumber(value: string, fallback: number, label: string, strict = false) {
  const parsed = Number(value);

  if (Number.isFinite(parsed) && (!strict || label === 'volume' || parsed > 0)) {
    return parsed;
  }

  if (strict) {
    throw new Error(`Invalid Bybit candle ${label}: ${value}`);
  }

  return fallback;
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
