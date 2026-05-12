import type { Candle, MarketPair, Timeframe } from '../../types/market';
import { getThoonServerEnv } from '../env';
import { getBybitMarketCandles } from './bybit-market-data';

type ExchangeId = 'bitget' | 'bybit' | 'coinbase-advanced' | 'kraken' | 'kucoin' | 'okx';

type PublicRestCandleOptions = {
  marketType?: 'futures' | 'perpetual' | 'spot';
  strict?: boolean;
};

type OkxCandlesResponse = {
  code: string;
  data?: string[][];
  msg?: string;
};

type BitgetCandlesResponse = {
  code: string;
  data?: string[][];
  msg?: string;
};

type KrakenOhlcResponse = {
  error: string[];
  result?: Record<string, unknown>;
};

type KucoinCandlesResponse = {
  code: string;
  data?: string[][];
  msg?: string;
};

const publicExchangeIds = new Set<string>(['bybit', 'okx', 'bitget', 'kraken', 'kucoin', 'coinbase-advanced']);

const okxIntervals: Record<Timeframe, string> = {
  '1M': '1M',
  '1d': '1D',
  '1h': '1H',
  '1m': '1m',
  '1w': '1W',
  '1y': '1M',
  '2h': '2H',
  '30m': '30m',
  '4h': '4H',
  '5m': '5m',
  '15m': '15m',
};

const bitgetIntervals: Record<Timeframe, string> = {
  '1M': '1M',
  '1d': '1day',
  '1h': '1h',
  '1m': '1min',
  '1w': '1week',
  '1y': '1M',
  '2h': '1h',
  '30m': '30min',
  '4h': '4h',
  '5m': '5min',
  '15m': '15min',
};

const krakenIntervals: Record<Timeframe, number> = {
  '1M': 1440,
  '1d': 1440,
  '1h': 60,
  '1m': 1,
  '1w': 10080,
  '1y': 1440,
  '2h': 60,
  '30m': 30,
  '4h': 240,
  '5m': 5,
  '15m': 15,
};

const kucoinIntervals: Record<Timeframe, string> = {
  '1M': '1month',
  '1d': '1day',
  '1h': '1hour',
  '1m': '1min',
  '1w': '1week',
  '1y': '1month',
  '2h': '2hour',
  '30m': '30min',
  '4h': '4hour',
  '5m': '5min',
  '15m': '15min',
};

const coinbaseGranularities: Record<Timeframe, number> = {
  '1M': 86400,
  '1d': 86400,
  '1h': 3600,
  '1m': 60,
  '1w': 86400,
  '1y': 86400,
  '2h': 3600,
  '30m': 900,
  '4h': 3600,
  '5m': 300,
  '15m': 900,
};

export function hasPublicRestMarketData(exchangeId: string | undefined) {
  return exchangeId ? publicExchangeIds.has(exchangeId) : false;
}

export async function getPublicRestMarketCandles(seedPairs: MarketPair[], symbol: string, timeframe: Timeframe, exchangeId: string, requestedLimit?: number, options: PublicRestCandleOptions = {}): Promise<Candle[]> {
  const pair = seedPairs.find((item) => item.symbol === symbol);

  if (!pair || !hasPublicRestMarketData(exchangeId)) {
    if (options.strict) {
      throw new Error(`${exchangeId} public REST candles are not available for ${symbol}.`);
    }

    return [];
  }

  try {
    switch (exchangeId as ExchangeId) {
      case 'bybit':
        return await getBybitMarketCandles(seedPairs, symbol, timeframe, requestedLimit, options);
      case 'okx':
        return await getOkxMarketCandles(pair, timeframe, requestedLimit, options);
      case 'bitget':
        return await getBitgetMarketCandles(pair, timeframe, requestedLimit, options);
      case 'kraken':
        return await getKrakenMarketCandles(pair, timeframe, options);
      case 'kucoin':
        return await getKucoinMarketCandles(pair, timeframe, options);
      case 'coinbase-advanced':
        return await getCoinbaseMarketCandles(pair, timeframe, options);
    }
  } catch (error) {
    if (options.strict) {
      throw error;
    }

    return [];
  }
}

async function getOkxMarketCandles(pair: MarketPair, timeframe: Timeframe, requestedLimit?: number, options: PublicRestCandleOptions = {}) {
  const { marketKlineLimit, okxMarketBaseUrl } = getThoonServerEnv();
  const response = await fetchExchangeJson<OkxCandlesResponse>(okxMarketBaseUrl, '/api/v5/market/candles', {
    bar: okxIntervals[timeframe],
    instId: okxInstrumentId(pair.symbol, options.marketType),
    limit: String(Math.max(1, Math.floor(requestedLimit ?? marketKlineLimit))),
  });

  if (response.code !== '0' || !response.data) {
    throw new Error(`OKX candles failed: ${response.msg || response.code}`);
  }

  const candles = response.data.map((item) => candleFromOhlcv({ close: item[4], high: item[2], low: item[3], open: item[1], time: Number(item[0]) / 1000, volume: item[5] }, options)).reverse();

  return timeframe === '1y' ? aggregateCandles(candles, 12) : candles;
}

async function getBitgetMarketCandles(pair: MarketPair, timeframe: Timeframe, requestedLimit?: number, options: PublicRestCandleOptions = {}) {
  const { bitgetMarketBaseUrl, marketKlineLimit } = getThoonServerEnv();
  const limit = Math.max(1, Math.floor(requestedLimit ?? marketKlineLimit));
  const perpetual = options.marketType !== 'spot';
  const response = await fetchExchangeJson<BitgetCandlesResponse>(
    bitgetMarketBaseUrl,
    perpetual ? '/api/v2/mix/market/candles' : '/api/v2/spot/market/candles',
    {
      granularity: bitgetIntervals[timeframe],
      limit: String(timeframe === '2h' ? limit * 2 : limit),
      ...(perpetual ? { productType: 'USDT-FUTURES' } : {}),
      symbol: toCompactSymbol(pair.symbol, { 'RNDR/USDT': 'RENDERUSDT' }),
    },
  );

  if (response.code !== '00000' || !response.data) {
    throw new Error(`Bitget candles failed: ${response.msg || response.code}`);
  }

  const candles = response.data.map((item) => candleFromOhlcv({ close: item[4], high: item[2], low: item[3], open: item[1], time: Number(item[0]) / 1000, volume: item[5] }, options)).reverse();

  if (timeframe === '2h') {
    return aggregateCandles(candles, 2);
  }

  return timeframe === '1y' ? aggregateCandles(candles, 12) : candles;
}

async function getKrakenMarketCandles(pair: MarketPair, timeframe: Timeframe, options: PublicRestCandleOptions = {}) {
  if (options.marketType !== 'spot') {
    throw new Error('Kraken perpetual candles are not wired to a public REST provider in Thoon yet.');
  }

  const { krakenMarketBaseUrl } = getThoonServerEnv();
  const response = await fetchExchangeJson<KrakenOhlcResponse>(krakenMarketBaseUrl, '/0/public/OHLC', {
    interval: String(krakenIntervals[timeframe]),
    pair: toKrakenPair(pair.symbol),
  });

  if (response.error.length || !response.result) {
    throw new Error(`Kraken OHLC failed: ${response.error.join(', ')}`);
  }

  const resultKey = Object.keys(response.result).find((key) => key !== 'last');
  const rawCandles = resultKey ? response.result[resultKey] : undefined;

  if (!Array.isArray(rawCandles)) {
    if (options.strict) {
      throw new Error('Kraken OHLC response did not include candle rows.');
    }

    return [];
  }

  const candles = rawCandles
    .filter(Array.isArray)
    .map((item) => candleFromOhlcv({ close: String(item[4]), high: String(item[2]), low: String(item[3]), open: String(item[1]), time: Number(item[0]), volume: String(item[6]) }, options));

  if (timeframe === '2h') {
    return aggregateCandles(candles, 2);
  }

  if (timeframe === '1M') {
    return aggregateCandles(candles, 30);
  }

  if (timeframe === '1y') {
    return aggregateCandles(candles, 365);
  }

  return candles;
}

async function getKucoinMarketCandles(pair: MarketPair, timeframe: Timeframe, options: PublicRestCandleOptions = {}) {
  if (options.marketType !== 'spot') {
    throw new Error('KuCoin perpetual candles are not wired to a public REST provider in Thoon yet.');
  }

  const { kucoinMarketBaseUrl } = getThoonServerEnv();
  const response = await fetchExchangeJson<KucoinCandlesResponse>(kucoinMarketBaseUrl, '/api/v1/market/candles', {
    symbol: toDashedSymbol(pair.symbol),
    type: kucoinIntervals[timeframe],
  });

  if (response.code !== '200000' || !response.data) {
    throw new Error(`KuCoin candles failed: ${response.msg || response.code}`);
  }

  const candles = response.data.map((item) => candleFromOhlcv({ close: item[2], high: item[3], low: item[4], open: item[1], time: Number(item[0]), volume: item[5] }, options)).reverse();

  return timeframe === '1y' ? aggregateCandles(candles, 12) : candles;
}

async function getCoinbaseMarketCandles(pair: MarketPair, timeframe: Timeframe, options: PublicRestCandleOptions = {}) {
  if (options.marketType !== 'spot') {
    throw new Error('Coinbase perpetual candles are not wired to a public REST provider in Thoon yet.');
  }

  const { coinbaseAdvancedMarketBaseUrl } = getThoonServerEnv();
  const productIds = coinbaseProductCandidates(pair.symbol);
  let lastError: unknown;

  for (const productId of productIds) {
    try {
      const response = await fetchExchangeJson<Array<[number, number, number, number, number, number]>>(coinbaseAdvancedMarketBaseUrl, `/products/${productId}/candles`, {
        granularity: String(coinbaseGranularities[timeframe]),
      });
      const candles = response.map((item) => candleFromOhlcv({ close: String(item[4]), high: String(item[2]), low: String(item[1]), open: String(item[3]), time: item[0], volume: String(item[5]) }, options)).reverse();

      return aggregateCoinbaseCandles(candles, timeframe);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Coinbase candles unavailable');
}

async function fetchExchangeJson<T>(baseUrl: string, path: string, params: Record<string, string>): Promise<T> {
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
    throw new Error(`${url.hostname}${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function candleFromOhlcv(input: { close: string; high: string; low: string; open: string; time: number; volume: string }, options: { strict?: boolean } = {}): Candle {
  return {
    close: marketNumber(input.close, 'close', options.strict),
    high: marketNumber(input.high, 'high', options.strict),
    low: marketNumber(input.low, 'low', options.strict),
    open: marketNumber(input.open, 'open', options.strict),
    time: Math.floor(marketTime(input.time, options.strict)),
    volume: marketNumber(input.volume, 'volume', options.strict),
  };
}

function aggregateCoinbaseCandles(candles: Candle[], timeframe: Timeframe) {
  switch (timeframe) {
    case '30m':
    case '2h':
      return aggregateCandles(candles, 2);
    case '4h':
      return aggregateCandles(candles, 4);
    case '1w':
      return aggregateCandles(candles, 7);
    case '1M':
      return aggregateCandles(candles, 30);
    case '1y':
      return aggregateCandles(candles, 365);
    default:
      return candles;
  }
}

function toCompactSymbol(symbol: string, aliases: Record<string, string> = {}) {
  return aliases[symbol] ?? symbol.replace('/', '').toUpperCase();
}

function toDashedSymbol(symbol: string, aliases: Record<string, string> = {}) {
  return aliases[symbol] ?? symbol.replace('/', '-').toUpperCase();
}

function okxInstrumentId(symbol: string, marketType: PublicRestCandleOptions['marketType']) {
  const spotSymbol = toDashedSymbol(symbol, { 'RNDR/USDT': 'RENDER-USDT' });

  return marketType === 'spot' ? spotSymbol : `${spotSymbol}-SWAP`;
}

function toKrakenPair(symbol: string) {
  const [base = '', quote = 'USDT'] = symbol.split('/');
  const normalizedBase = base === 'BTC' ? 'XBT' : base === 'DOGE' ? 'XDG' : base;

  return `${normalizedBase}${quote}`.toUpperCase();
}

function coinbaseProductCandidates(symbol: string) {
  const [base = '', quote = 'USDT'] = symbol.split('/');
  const normalizedBase = base === 'RNDR' ? 'RENDER' : base === 'MATIC' ? 'POL' : base;
  const candidates = [`${normalizedBase}-${quote}`.toUpperCase()];

  if (quote === 'USDT') {
    candidates.push(`${normalizedBase}-USD`.toUpperCase(), `${normalizedBase}-USDC`.toUpperCase());
  }

  return Array.from(new Set(candidates));
}

function marketNumber(value: string, label: string, strict = false) {
  const parsed = Number(value);

  if (Number.isFinite(parsed) && (!strict || label === 'volume' || parsed > 0)) {
    return parsed;
  }

  if (strict) {
    throw new Error(`Invalid public REST candle ${label}: ${value}`);
  }

  return 0;
}

function marketTime(value: number, strict = false) {
  if (Number.isFinite(value)) {
    return value;
  }

  if (strict) {
    throw new Error(`Invalid public REST candle time: ${value}`);
  }

  return 0;
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
