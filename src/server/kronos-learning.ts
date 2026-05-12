import type { Candle, Timeframe } from '../types/market';
import type { KronosForecastDirection, KronosForecastRecord, KronosLearningProfile } from '../types/trading';

type AdvanceKronosLearningInput = {
  candles: Candle[];
  market: string;
  records: KronosForecastRecord[];
  strategyId?: string;
  timeframe: Timeframe;
};

export function advanceKronosLearning(input: AdvanceKronosLearningInput) {
  const beforeProfile = getKronosLearningProfile(input.records);
  const evaluatedRecords = evaluatePendingForecasts(input.records, input.candles, input.market, input.timeframe);
  const createdRecord = createLatestForecast({
    candles: input.candles,
    market: input.market,
    records: evaluatedRecords,
    strategyId: input.strategyId,
    timeframe: input.timeframe,
    weight: beforeProfile.confidenceWeight,
  });
  const nextRecords = createdRecord ? [createdRecord, ...evaluatedRecords] : evaluatedRecords;
  const nextProfile = getKronosLearningProfile(nextRecords);

  return {
    created: createdRecord,
    evaluatedCount: nextRecords.filter((record) => record.status === 'evaluated').length - input.records.filter((record) => record.status === 'evaluated').length,
    profile: nextProfile,
    records: dedupeForecasts(nextRecords).slice(0, 500),
  };
}

export function getKronosLearningProfile(records: KronosForecastRecord[] = []): KronosLearningProfile {
  const evaluated = records.filter((record) => record.status === 'evaluated' && typeof record.hit === 'boolean');
  const pending = records.filter((record) => record.status === 'pending');
  const recent = evaluated
    .slice()
    .sort((left, right) => new Date(right.realizedAt ?? right.createdAt).getTime() - new Date(left.realizedAt ?? left.createdAt).getTime())
    .slice(0, 120);
  const hits = recent.filter((record) => record.hit).length;
  const accuracy = recent.length ? hits / recent.length : 0;
  const sampleFactor = Math.min(1, recent.length / 60);
  const confidenceWeight = recent.length ? clamp(0.45 + (accuracy - 0.5) * 1.35 + sampleFactor * 0.25, 0.25, 1.25) : 0.5;
  const lastEvaluatedAt = recent[0]?.realizedAt;

  return {
    accuracy: round(accuracy, 3),
    confidenceWeight: round(confidenceWeight, 3),
    evaluated: evaluated.length,
    lastEvaluatedAt,
    pending: pending.length,
    sampleQuality: evaluated.length >= 60 ? 'stable' : evaluated.length >= 12 ? 'learning' : 'cold_start',
  };
}

export function kronosLearningContextPrompt(records: KronosForecastRecord[] = []) {
  const profile = getKronosLearningProfile(records);
  const recent = records
    .filter((record) => record.status === 'evaluated')
    .slice()
    .sort((left, right) => new Date(right.realizedAt ?? right.createdAt).getTime() - new Date(left.realizedAt ?? left.createdAt).getTime())
    .slice(0, 8)
    .map((record) => `${record.market} ${record.timeframe}: ${record.predictedDirection}->${record.realizedDirection ?? 'unknown'} ${record.hit ? 'hit' : 'miss'} (${round(record.realizedReturnPct ?? 0, 2)}%)`);

  return [
    `Kronos learning profile: ${profile.evaluated} evaluated, ${profile.pending} pending, accuracy ${(profile.accuracy * 100).toFixed(1)}%, confidence weight ${profile.confidenceWeight.toFixed(2)}, sample ${profile.sampleQuality}.`,
    `Recent evaluated forecasts: ${recent.length ? recent.join(' | ') : 'none yet'}.`,
    'Use the confidence weight as a ranking modifier only. It must never override backtests, paper tests, fees, slippage, or risk rules.',
  ].join('\n');
}

function evaluatePendingForecasts(records: KronosForecastRecord[], candles: Candle[], market: string, timeframe: Timeframe) {
  return records.map((record) => {
    if (record.status !== 'pending' || record.market !== market || record.timeframe !== timeframe) {
      return record;
    }

    const anchorIndex = candles.findIndex((candle) => candle.time === record.anchorTime);
    const targetCandle = anchorIndex >= 0 ? candles[anchorIndex + record.horizonCandles] : undefined;

    if (!targetCandle) {
      return record;
    }

    const realizedReturnPct = ((targetCandle.close - record.anchorClose) / record.anchorClose) * 100;
    const realizedDirection = directionFromReturn(realizedReturnPct);
    const errorPct = Math.abs(realizedReturnPct - record.predictedReturnPct);

    return {
      ...record,
      errorPct: round(errorPct, 3),
      hit: realizedDirection === record.predictedDirection || (record.predictedDirection === 'range' && Math.abs(realizedReturnPct) < 0.35),
      realizedAt: new Date(targetCandle.time * 1000).toISOString(),
      realizedClose: round(targetCandle.close, 8),
      realizedDirection,
      realizedReturnPct: round(realizedReturnPct, 3),
      status: 'evaluated' as const,
    };
  });
}

function createLatestForecast(input: AdvanceKronosLearningInput & { records: KronosForecastRecord[]; weight: number }): KronosForecastRecord | undefined {
  const candles = input.candles;
  const latest = candles[candles.length - 1];

  if (!latest || candles.length < 32) {
    return undefined;
  }

  const existing = input.records.some((record) => record.market === input.market && record.timeframe === input.timeframe && record.anchorTime === latest.time);

  if (existing) {
    return undefined;
  }

  const closes = candles.map((candle) => candle.close);
  const returns = closes.slice(1).map((close, index) => ((close - closes[index]) / closes[index]) * 100);
  const recentReturns = returns.slice(-8);
  const baseReturns = returns.slice(-32);
  const momentum = average(recentReturns);
  const volatility = Math.max(0.1, standardDeviation(baseReturns));
  const predictedDirection: KronosForecastDirection = Math.abs(momentum) < volatility * 0.22 ? 'range' : momentum > 0 ? 'up' : 'down';
  const confidence = clamp(0.52 + Math.min(0.28, Math.abs(momentum) / (volatility * 5)), 0.52, 0.8);
  const horizonCandles = forecastHorizon(input.timeframe);

  return {
    anchorClose: round(latest.close, 8),
    anchorTime: latest.time,
    confidence: round(confidence, 3),
    createdAt: new Date().toISOString(),
    horizonCandles,
    id: `kronos-${slug(input.market)}-${input.timeframe}-${latest.time}`,
    market: input.market,
    modelName: 'Kronos-proxy-v1',
    predictedDirection,
    predictedReturnPct: round(momentum * horizonCandles * input.weight, 3),
    source: 'heuristic-proxy' as const,
    status: 'pending' as const,
    strategyId: input.strategyId,
    timeframe: input.timeframe,
    weightAtCreation: round(input.weight, 3),
  };
}

function directionFromReturn(value: number): KronosForecastDirection {
  if (value > 0.35) {
    return 'up';
  }

  if (value < -0.35) {
    return 'down';
  }

  return 'range';
}

function forecastHorizon(timeframe: Timeframe) {
  if (timeframe === '1m' || timeframe === '5m' || timeframe === '15m') {
    return 8;
  }

  if (timeframe === '30m' || timeframe === '1h') {
    return 6;
  }

  return 4;
}

function dedupeForecasts(records: KronosForecastRecord[]) {
  const byId = new Map<string, KronosForecastRecord>();

  for (const record of records) {
    byId.set(record.id, record);
  }

  return Array.from(byId.values()).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));

  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'market';
}
