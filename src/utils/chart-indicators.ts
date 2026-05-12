import type { Candle } from '../types/market';

export type IndicatorPoint = {
  time: Candle['time'];
  value: number;
};

type Enabled = {
  enabled: boolean;
};

type PeriodConfig = Enabled & {
  period: number;
};

type ChannelConfig = Enabled & {
  period: number;
  multiplier: number;
};

type BollingerConfig = Enabled & {
  period: number;
  stdDev: number;
};

type MacdConfig = Enabled & {
  fastPeriod: number;
  signalPeriod: number;
  slowPeriod: number;
};

type StochasticConfig = Enabled & {
  dPeriod: number;
  kPeriod: number;
};

type StochRsiConfig = Enabled & {
  dPeriod: number;
  rsiPeriod: number;
  stochPeriod: number;
};

type IchimokuConfig = Enabled & {
  basePeriod: number;
  conversionPeriod: number;
  spanBPeriod: number;
};

type ParabolicSarConfig = Enabled & {
  max: number;
  step: number;
};

export type ChartIndicatorConfig = {
  adx: PeriodConfig;
  aroon: PeriodConfig;
  atr: PeriodConfig;
  bollinger: BollingerConfig;
  cci: PeriodConfig;
  cmf: PeriodConfig;
  donchian: PeriodConfig;
  ema: PeriodConfig;
  hma: PeriodConfig;
  ichimoku: IchimokuConfig;
  keltner: ChannelConfig;
  maFast: PeriodConfig;
  maSlow: PeriodConfig;
  macd: MacdConfig;
  mfi: PeriodConfig;
  momentum: PeriodConfig;
  obv: Enabled;
  parabolicSar: ParabolicSarConfig;
  roc: PeriodConfig;
  rsi: PeriodConfig;
  stochastic: StochasticConfig;
  stochRsi: StochRsiConfig;
  supertrend: ChannelConfig;
  trix: PeriodConfig;
  volume: Enabled;
  vwap: Enabled;
  vwma: PeriodConfig;
  williamsR: PeriodConfig;
  wma: PeriodConfig;
};

export const defaultChartIndicatorConfig: ChartIndicatorConfig = {
  adx: { enabled: false, period: 14 },
  aroon: { enabled: false, period: 25 },
  atr: { enabled: false, period: 14 },
  bollinger: { enabled: false, period: 20, stdDev: 2 },
  cci: { enabled: false, period: 20 },
  cmf: { enabled: false, period: 20 },
  donchian: { enabled: false, period: 20 },
  ema: { enabled: false, period: 21 },
  hma: { enabled: false, period: 55 },
  ichimoku: { enabled: false, basePeriod: 26, conversionPeriod: 9, spanBPeriod: 52 },
  keltner: { enabled: false, multiplier: 2, period: 20 },
  maFast: { enabled: true, period: 50 },
  maSlow: { enabled: true, period: 200 },
  macd: { enabled: false, fastPeriod: 12, signalPeriod: 9, slowPeriod: 26 },
  mfi: { enabled: false, period: 14 },
  momentum: { enabled: false, period: 10 },
  obv: { enabled: false },
  parabolicSar: { enabled: false, max: 0.2, step: 0.02 },
  roc: { enabled: false, period: 12 },
  rsi: { enabled: false, period: 14 },
  stochastic: { enabled: false, dPeriod: 3, kPeriod: 14 },
  stochRsi: { enabled: false, dPeriod: 3, rsiPeriod: 14, stochPeriod: 14 },
  supertrend: { enabled: false, multiplier: 3, period: 10 },
  trix: { enabled: false, period: 18 },
  volume: { enabled: true },
  vwap: { enabled: false },
  vwma: { enabled: false, period: 20 },
  williamsR: { enabled: false, period: 14 },
  wma: { enabled: false, period: 20 },
};

export function normalizeChartIndicatorConfig(value?: Partial<ChartIndicatorConfig>): ChartIndicatorConfig {
  return {
    adx: { ...defaultChartIndicatorConfig.adx, ...value?.adx },
    aroon: { ...defaultChartIndicatorConfig.aroon, ...value?.aroon },
    atr: { ...defaultChartIndicatorConfig.atr, ...value?.atr },
    bollinger: { ...defaultChartIndicatorConfig.bollinger, ...value?.bollinger },
    cci: { ...defaultChartIndicatorConfig.cci, ...value?.cci },
    cmf: { ...defaultChartIndicatorConfig.cmf, ...value?.cmf },
    donchian: { ...defaultChartIndicatorConfig.donchian, ...value?.donchian },
    ema: { ...defaultChartIndicatorConfig.ema, ...value?.ema },
    hma: { ...defaultChartIndicatorConfig.hma, ...value?.hma },
    ichimoku: { ...defaultChartIndicatorConfig.ichimoku, ...value?.ichimoku },
    keltner: { ...defaultChartIndicatorConfig.keltner, ...value?.keltner },
    maFast: { ...defaultChartIndicatorConfig.maFast, ...value?.maFast },
    maSlow: { ...defaultChartIndicatorConfig.maSlow, ...value?.maSlow },
    macd: { ...defaultChartIndicatorConfig.macd, ...value?.macd },
    mfi: { ...defaultChartIndicatorConfig.mfi, ...value?.mfi },
    momentum: { ...defaultChartIndicatorConfig.momentum, ...value?.momentum },
    obv: { ...defaultChartIndicatorConfig.obv, ...value?.obv },
    parabolicSar: { ...defaultChartIndicatorConfig.parabolicSar, ...value?.parabolicSar },
    roc: { ...defaultChartIndicatorConfig.roc, ...value?.roc },
    rsi: { ...defaultChartIndicatorConfig.rsi, ...value?.rsi },
    stochastic: { ...defaultChartIndicatorConfig.stochastic, ...value?.stochastic },
    stochRsi: { ...defaultChartIndicatorConfig.stochRsi, ...value?.stochRsi },
    supertrend: { ...defaultChartIndicatorConfig.supertrend, ...value?.supertrend },
    trix: { ...defaultChartIndicatorConfig.trix, ...value?.trix },
    volume: { ...defaultChartIndicatorConfig.volume, ...value?.volume },
    vwap: { ...defaultChartIndicatorConfig.vwap, ...value?.vwap },
    vwma: { ...defaultChartIndicatorConfig.vwma, ...value?.vwma },
    williamsR: { ...defaultChartIndicatorConfig.williamsR, ...value?.williamsR },
    wma: { ...defaultChartIndicatorConfig.wma, ...value?.wma },
  };
}

export function movingAverageSeries(candles: Candle[], period: number) {
  return seriesFromValues(candles, simpleMovingAverageValues(candles.map((candle) => candle.close), period));
}

export function exponentialAverageSeries(candles: Candle[], period: number) {
  return seriesFromValues(candles, emaValues(candles.map((candle) => candle.close), period));
}

export function weightedMovingAverageSeries(candles: Candle[], period: number) {
  return seriesFromValues(candles, wmaValues(candles.map((candle) => candle.close), period));
}

export function hullMovingAverageSeries(candles: Candle[], period: number) {
  const closes = candles.map((candle) => candle.close);
  const half = wmaValues(closes, Math.max(1, Math.round(period / 2)));
  const full = wmaValues(closes, period);
  const raw = closes.map((_close, index) => 2 * (half[index] ?? closes[index] ?? 0) - (full[index] ?? closes[index] ?? 0));

  return seriesFromValues(candles, wmaValues(raw, Math.max(1, Math.round(Math.sqrt(safePeriod(period))))));
}

export function volumeWeightedMovingAverageSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);

  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - safe + 1), index + 1);
    const volume = window.reduce((sum, item) => sum + item.volume, 0);
    const value = volume > 0 ? window.reduce((sum, item) => sum + item.close * item.volume, 0) / volume : candle.close;

    return { time: candle.time, value };
  });
}

export function vwapSeries(candles: Candle[]) {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return candles.map((candle) => {
    const typicalPrice = typical(candle);
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    return {
      time: candle.time,
      value: cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : candle.close,
    };
  });
}

export function bollingerBands(candles: Candle[], period: number, stdDev: number) {
  const safe = safePeriod(period);
  const multiplier = finiteNumber(stdDev, 2);

  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - safe + 1), index + 1);
    const middle = average(window.map((item) => item.close)) || candle.close;
    const deviation = standardDeviation(window.map((item) => item.close), middle);

    return {
      lower: middle - deviation * multiplier,
      middle,
      time: candle.time,
      upper: middle + deviation * multiplier,
    };
  });
}

export function donchianChannel(candles: Candle[], period: number) {
  const safe = safePeriod(period);

  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - safe + 1), index + 1);
    const upper = Math.max(...window.map((item) => item.high));
    const lower = Math.min(...window.map((item) => item.low));

    return {
      lower,
      middle: (upper + lower) / 2,
      time: candle.time,
      upper,
    };
  });
}

export function keltnerChannel(candles: Candle[], period: number, multiplier: number) {
  const middle = emaValues(candles.map((candle) => candle.close), period);
  const atr = atrValues(candles, period);
  const mult = finiteNumber(multiplier, 2);

  return candles.map((candle, index) => ({
    lower: (middle[index] ?? candle.close) - (atr[index] ?? 0) * mult,
    middle: middle[index] ?? candle.close,
    time: candle.time,
    upper: (middle[index] ?? candle.close) + (atr[index] ?? 0) * mult,
  }));
}

export function ichimokuLines(candles: Candle[], conversionPeriod: number, basePeriod: number, spanBPeriod: number) {
  const conversion = midpointSeries(candles, conversionPeriod);
  const base = midpointSeries(candles, basePeriod);
  const spanB = midpointSeries(candles, spanBPeriod);

  return candles.map((candle, index) => {
    const conversionValue = conversion[index]?.value ?? candle.close;
    const baseValue = base[index]?.value ?? candle.close;

    return {
      base: baseValue,
      conversion: conversionValue,
      spanA: (conversionValue + baseValue) / 2,
      spanB: spanB[index]?.value ?? candle.close,
      time: candle.time,
    };
  });
}

export function supertrendSeries(candles: Candle[], period: number, multiplier: number) {
  if (!candles.length) {
    return [];
  }

  const atr = atrValues(candles, period);
  const mult = finiteNumber(multiplier, 3);
  let finalUpper = 0;
  let finalLower = 0;
  let trend = candles[0].close;
  let direction = 1;

  return candles.map((candle, index) => {
    const median = (candle.high + candle.low) / 2;
    const basicUpper = median + (atr[index] ?? 0) * mult;
    const basicLower = median - (atr[index] ?? 0) * mult;
    const previous = candles[index - 1];

    finalUpper = index === 0 || basicUpper < finalUpper || (previous && previous.close > finalUpper) ? basicUpper : finalUpper;
    finalLower = index === 0 || basicLower > finalLower || (previous && previous.close < finalLower) ? basicLower : finalLower;

    if (direction === -1 && candle.close > finalUpper) {
      direction = 1;
    } else if (direction === 1 && candle.close < finalLower) {
      direction = -1;
    }

    trend = direction === 1 ? finalLower : finalUpper;

    return { time: candle.time, value: trend };
  });
}

export function parabolicSarSeries(candles: Candle[], step: number, max: number) {
  if (!candles.length) {
    return [];
  }

  const safeStep = Math.max(0.001, finiteNumber(step, 0.02));
  const safeMax = Math.max(safeStep, finiteNumber(max, 0.2));
  let rising = true;
  let acceleration = safeStep;
  let extremePoint = candles[0].high;
  let sar = candles[0].low;

  return candles.map((candle, index) => {
    if (index === 0) {
      return { time: candle.time, value: sar };
    }

    const previous = candles[index - 1];
    sar += acceleration * (extremePoint - sar);

    if (rising) {
      sar = Math.min(sar, previous.low, candle.low);

      if (candle.low < sar) {
        rising = false;
        sar = extremePoint;
        extremePoint = candle.low;
        acceleration = safeStep;
      } else if (candle.high > extremePoint) {
        extremePoint = candle.high;
        acceleration = Math.min(safeMax, acceleration + safeStep);
      }
    } else {
      sar = Math.max(sar, previous.high, candle.high);

      if (candle.high > sar) {
        rising = true;
        sar = extremePoint;
        extremePoint = candle.high;
        acceleration = safeStep;
      } else if (candle.low < extremePoint) {
        extremePoint = candle.low;
        acceleration = Math.min(safeMax, acceleration + safeStep);
      }
    }

    return { time: candle.time, value: sar };
  });
}

export function atrSeries(candles: Candle[], period: number) {
  return seriesFromValues(candles, atrValues(candles, period));
}

export function rsiSeries(candles: Candle[], period: number) {
  return seriesFromValues(candles, rsiValues(candles.map((candle) => candle.close), period));
}

export function macdSeries(candles: Candle[], fastPeriod: number, slowPeriod: number, signalPeriod: number) {
  const closes = candles.map((candle) => candle.close);
  const fast = emaValues(closes, fastPeriod);
  const slow = emaValues(closes, slowPeriod);
  const macd = closes.map((_close, index) => (fast[index] ?? 0) - (slow[index] ?? 0));
  const signal = emaValues(macd, signalPeriod);
  const histogram = macd.map((value, index) => value - (signal[index] ?? 0));

  return {
    histogram: seriesFromValues(candles, histogram),
    line: seriesFromValues(candles, macd),
    signal: seriesFromValues(candles, signal),
  };
}

export function stochasticSeries(candles: Candle[], kPeriod: number, dPeriod: number) {
  const safeK = safePeriod(kPeriod);
  const kValues = candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - safeK + 1), index + 1);
    const high = Math.max(...window.map((item) => item.high));
    const low = Math.min(...window.map((item) => item.low));

    return high === low ? 50 : ((candle.close - low) / (high - low)) * 100;
  });

  return {
    d: seriesFromValues(candles, simpleMovingAverageValues(kValues, dPeriod)),
    k: seriesFromValues(candles, kValues),
  };
}

export function stochRsiSeries(candles: Candle[], rsiPeriod: number, stochPeriod: number, dPeriod: number) {
  const rsi = rsiValues(candles.map((candle) => candle.close), rsiPeriod);
  const safe = safePeriod(stochPeriod);
  const kValues = rsi.map((value, index) => {
    const window = rsi.slice(Math.max(0, index - safe + 1), index + 1);
    const high = Math.max(...window);
    const low = Math.min(...window);

    return high === low ? 50 : ((value - low) / (high - low)) * 100;
  });

  return {
    d: seriesFromValues(candles, simpleMovingAverageValues(kValues, dPeriod)),
    k: seriesFromValues(candles, kValues),
  };
}

export function cciSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);
  const typicals = candles.map(typical);

  return seriesFromValues(
    candles,
    typicals.map((value, index) => {
      const window = typicals.slice(Math.max(0, index - safe + 1), index + 1);
      const mean = average(window) || value;
      const deviation = average(window.map((item) => Math.abs(item - mean)));

      return deviation ? (value - mean) / (0.015 * deviation) : 0;
    }),
  );
}

export function williamsRSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);

  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - safe + 1), index + 1);
    const high = Math.max(...window.map((item) => item.high));
    const low = Math.min(...window.map((item) => item.low));
    const value = high === low ? -50 : ((high - candle.close) / (high - low)) * -100;

    return { time: candle.time, value };
  });
}

export function rocSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);

  return candles.map((candle, index) => {
    const previous = candles[Math.max(0, index - safe)]?.close ?? candle.close;
    const value = previous === 0 ? 0 : ((candle.close - previous) / previous) * 100;

    return { time: candle.time, value };
  });
}

export function momentumSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);

  return candles.map((candle, index) => {
    const previous = candles[Math.max(0, index - safe)]?.close ?? candle.close;

    return { time: candle.time, value: candle.close - previous };
  });
}

export function trixSeries(candles: Candle[], period: number) {
  const closes = candles.map((candle) => candle.close);
  const ema1 = emaValues(closes, period);
  const ema2 = emaValues(ema1, period);
  const ema3 = emaValues(ema2, period);

  return seriesFromValues(
    candles,
    ema3.map((value, index) => {
      const previous = ema3[Math.max(0, index - 1)] ?? value;

      return previous === 0 ? 0 : ((value - previous) / previous) * 100;
    }),
  );
}

export function obvSeries(candles: Candle[]) {
  let obv = 0;

  return candles.map((candle, index) => {
    const previous = candles[index - 1];

    if (previous) {
      obv += candle.close > previous.close ? candle.volume : candle.close < previous.close ? -candle.volume : 0;
    }

    return { time: candle.time, value: obv };
  });
}

export function mfiSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);
  const moneyFlow = candles.map((candle) => typical(candle) * candle.volume);

  return candles.map((candle, index) => {
    const start = Math.max(1, index - safe + 1);
    let positive = 0;
    let negative = 0;

    for (let cursor = start; cursor <= index; cursor += 1) {
      const currentTypical = typical(candles[cursor]);
      const previousTypical = typical(candles[cursor - 1]);

      if (currentTypical >= previousTypical) {
        positive += moneyFlow[cursor] ?? 0;
      } else {
        negative += moneyFlow[cursor] ?? 0;
      }
    }

    const ratio = negative === 0 ? 100 : positive / negative;

    return { time: candle.time, value: 100 - 100 / (1 + ratio) };
  });
}

export function cmfSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);

  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - safe + 1), index + 1);
    const volume = window.reduce((sum, item) => sum + item.volume, 0);
    const moneyFlowVolume = window.reduce((sum, item) => {
      const range = item.high - item.low;
      const multiplier = range === 0 ? 0 : ((item.close - item.low) - (item.high - item.close)) / range;

      return sum + multiplier * item.volume;
    }, 0);

    return { time: candle.time, value: volume === 0 ? 0 : moneyFlowVolume / volume };
  });
}

export function aroonSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);

  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - safe + 1), index + 1);
    const highIndex = window.reduce((bestIndex, item, currentIndex) => (item.high >= window[bestIndex].high ? currentIndex : bestIndex), 0);
    const lowIndex = window.reduce((bestIndex, item, currentIndex) => (item.low <= window[bestIndex].low ? currentIndex : bestIndex), 0);
    const periodsSinceHigh = window.length - 1 - highIndex;
    const periodsSinceLow = window.length - 1 - lowIndex;

    return {
      down: ((safe - periodsSinceLow) / safe) * 100,
      time: candle.time,
      up: ((safe - periodsSinceHigh) / safe) * 100,
    };
  });
}

export function adxSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);
  const trueRanges = trueRangeValues(candles);
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  candles.forEach((candle, index) => {
    const previous = candles[index - 1];

    if (!previous) {
      plusDm.push(0);
      minusDm.push(0);
      return;
    }

    const upMove = candle.high - previous.high;
    const downMove = previous.low - candle.low;

    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  });

  const smoothedTr = wilderValues(trueRanges, safe);
  const smoothedPlusDm = wilderValues(plusDm, safe);
  const smoothedMinusDm = wilderValues(minusDm, safe);
  const dx = candles.map((_candle, index) => {
    const plusDi = smoothedTr[index] === 0 ? 0 : (smoothedPlusDm[index] / smoothedTr[index]) * 100;
    const minusDi = smoothedTr[index] === 0 ? 0 : (smoothedMinusDm[index] / smoothedTr[index]) * 100;
    const total = plusDi + minusDi;

    return total === 0 ? 0 : (Math.abs(plusDi - minusDi) / total) * 100;
  });

  return seriesFromValues(candles, wilderValues(dx, safe));
}

export function latestValue(points: IndicatorPoint[]) {
  return [...points].reverse().find((point) => Number.isFinite(point.value))?.value ?? 0;
}

function midpointSeries(candles: Candle[], period: number) {
  const safe = safePeriod(period);

  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - safe + 1), index + 1);
    const high = Math.max(...window.map((item) => item.high));
    const low = Math.min(...window.map((item) => item.low));

    return { time: candle.time, value: (high + low) / 2 };
  });
}

function atrValues(candles: Candle[], period: number) {
  return wilderValues(trueRangeValues(candles), period);
}

function trueRangeValues(candles: Candle[]) {
  return candles.map((candle, index) => {
    const previousClose = candles[index - 1]?.close ?? candle.close;

    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
}

function rsiValues(values: number[], period: number) {
  const safe = safePeriod(period);
  let averageGain = 0;
  let averageLoss = 0;

  return values.map((value, index) => {
    const previous = values[index - 1] ?? value;
    const change = value - previous;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);

    if (index === 0) {
      averageGain = gain;
      averageLoss = loss;
    } else if (index <= safe) {
      averageGain = (averageGain * (index - 1) + gain) / index;
      averageLoss = (averageLoss * (index - 1) + loss) / index;
    } else {
      averageGain = (averageGain * (safe - 1) + gain) / safe;
      averageLoss = (averageLoss * (safe - 1) + loss) / safe;
    }

    if (averageLoss === 0) {
      return 100;
    }

    const relativeStrength = averageGain / averageLoss;

    return 100 - 100 / (1 + relativeStrength);
  });
}

function wilderValues(values: number[], period: number) {
  const safe = safePeriod(period);
  let smoothed = values[0] ?? 0;

  return values.map((value, index) => {
    smoothed = index === 0 ? value : (smoothed * (safe - 1) + value) / safe;

    return smoothed;
  });
}

function simpleMovingAverageValues(values: number[], period: number) {
  const safe = safePeriod(period);

  return values.map((value, index) => {
    const window = values.slice(Math.max(0, index - safe + 1), index + 1);

    return average(window) || value;
  });
}

function emaValues(values: number[], period: number) {
  if (!values.length) {
    return [];
  }

  const safe = safePeriod(period);
  const multiplier = 2 / (safe + 1);
  let ema = values[0];

  return values.map((value, index) => {
    ema = index === 0 ? value : value * multiplier + ema * (1 - multiplier);

    return ema;
  });
}

function wmaValues(values: number[], period: number) {
  const safe = safePeriod(period);

  return values.map((value, index) => {
    const window = values.slice(Math.max(0, index - safe + 1), index + 1);
    const denominator = (window.length * (window.length + 1)) / 2;
    const weighted = window.reduce((sum, item, itemIndex) => sum + item * (itemIndex + 1), 0);

    return denominator === 0 ? value : weighted / denominator;
  });
}

function seriesFromValues(candles: Candle[], values: number[]) {
  return candles
    .map((candle, index) => ({ time: candle.time, value: values[index] ?? candle.close }))
    .filter((point) => Number.isFinite(point.value));
}

function typical(candle: Candle) {
  return (candle.high + candle.low + candle.close) / 3;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[], mean: number) {
  if (!values.length) {
    return 0;
  }

  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function safePeriod(period: number) {
  return Math.max(1, Math.round(finiteNumber(period, 1)));
}

function finiteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}
