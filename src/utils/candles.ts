import type { Candle } from '../types/market';

type SanitizeCandleOptions = {
  limit?: number;
};

export function sanitizeCandles(candles: Candle[], options: SanitizeCandleOptions = {}): Candle[] {
  const byTime = new Map<number, Candle>();

  for (const candle of candles) {
    const normalized = normalizeCandle(candle);

    if (normalized) {
      byTime.set(normalized.time, normalized);
    }
  }

  const sorted = Array.from(byTime.values()).sort((left, right) => left.time - right.time);

  return options.limit ? sorted.slice(-Math.max(1, Math.floor(options.limit))) : sorted;
}

export function normalizeCandle(candle: Candle | undefined): Candle | undefined {
  if (!candle) {
    return undefined;
  }

  const time = Math.floor(Number(candle.time));
  const open = Number(candle.open);
  const close = Number(candle.close);

  if (!Number.isFinite(time) || time <= 0 || !isPositivePrice(open) || !isPositivePrice(close)) {
    return undefined;
  }

  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);
  const rawHigh = Number(candle.high);
  const rawLow = Number(candle.low);
  const high = isPositivePrice(rawHigh) ? Math.max(rawHigh, bodyHigh) : bodyHigh;
  const low = isPositivePrice(rawLow) ? Math.min(rawLow, bodyLow) : bodyLow;
  const volume = Number(candle.volume);

  return {
    close,
    high,
    low,
    open,
    time,
    volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
  };
}

function isPositivePrice(value: number) {
  return Number.isFinite(value) && value > 0;
}
