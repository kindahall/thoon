import { JIMMY_SOURCE_ID, JIMMY_STRATEGY_ID } from '../config/jimmy-strategy';
import type { Candle, Timeframe } from '../types/market';
import type { BacktestReport, BacktestTrade, Strategy } from '../types/trading';

type RunBacktestInput = {
  candles: Candle[];
  exchangeId?: string;
  exchangeName?: string;
  feesPct: number;
  initialCapital: number;
  marketDataSource: BacktestReport['marketDataSource'];
  period: string;
  slippagePct: number;
  strategy: Strategy;
  symbol: string;
  timeframe: Timeframe;
};

type OpenTrade = {
  entry: number;
  entryIndex: number;
  entryTime: string;
  riskAmount: number;
  side: 'long' | 'short';
  size: number;
  stop: number;
  trail: number;
};

type JimmyBacktestProfile = {
  atrLength: number;
  atrStopMultiplier: number;
  atrTrailMultiplier: number;
  donchianLength: number;
  drawdownLookback: number;
  drawdownRecoveryLevel: number;
  drawdownThreshold: number;
  drawupLookback: number;
  drawupRecoveryLevel: number;
  drawupThreshold: number;
  fastMaLength: number;
  longMaLength: number;
  rsiLength: number;
  rsiOverbought: number;
  rsiOversold: number;
  slowMaLength: number;
  trixLength: number;
  trixSignalLength: number;
};

export function runBacktestFromCandles(input: RunBacktestInput): BacktestReport {
  const candles = selectPeriodCandles(input.candles, input.period, input.timeframe);
  const warnings: string[] = [];
  const profile = jimmyProfileFor(input.timeframe);
  const isJimmyBacktest = isJimmyStrategy(input.strategy);
  const isResearchAdaptation = Boolean(input.strategy.agentSource?.sourceId.startsWith('tradingview:'));

  if (candles.length < 40) {
    warnings.push(`Only ${candles.length} candles available. Results need more history before promotion.`);
  }

  if (candles.length < profile.longMaLength && isJimmyBacktest) {
    warnings.push(`MA ${profile.longMaLength} needs ${profile.longMaLength} candles; MA-based jimmy checks stay inactive until enough live candles exist.`);
  }

  if (isResearchAdaptation) {
    warnings.push('TradingView source is backtested as a Thoon concept adaptation from public metadata, not as the exact Pine script unless open code is later implemented.');
  }

  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);
  const fastMa = ema(closes, profile.fastMaLength);
  const slowMa = ema(closes, profile.slowMaLength);
  const longMa = sma(closes, profile.longMaLength);
  const trix = trixSeries(closes, profile.trixLength);
  const trixSignal = sma(trix, profile.trixSignalLength);
  const rsiValues = rsi(closes, profile.rsiLength);
  const atrValues = atr(candles, profile.atrLength);
  const volumeMa = sma(volumes, profile.donchianLength);
  const upper = rollingMax(highs, profile.donchianLength);
  const lower = rollingMin(lows, profile.donchianLength);
  const warmupBars = Math.max(profile.slowMaLength, profile.donchianLength, profile.rsiLength + 1, profile.atrLength, profile.trixLength * 3 + profile.trixSignalLength);

  let equity = input.initialCapital;
  let openTrade: OpenTrade | undefined;
  let drawdownEvent = false;
  let drawupEvent = false;
  const trades: BacktestTrade[] = [];
  const equityCurve: number[] = [];
  const feeRate = Math.max(0, input.feesPct) / 100;
  const slippageRate = Math.max(0, input.slippagePct) / 100;

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const atrValue = atrValues[index] ?? candle.close * 0.01;

    if (openTrade) {
      const exit = evaluateExit(input.strategy, candles, index, openTrade, longMa[index], atrValue, slippageRate, profile);

      if (exit) {
        const trade = closeTrade(input.strategy.id, candles, openTrade, index, exit.price, exit.reason, feeRate);
        equity += trade.pnl;
        trades.push(trade);
        openTrade = undefined;
      }
    }

    if (!openTrade && index > warmupBars) {
      const signal = entrySignal({
        candleIndex: index,
        candles,
        drawdownEvent,
        drawupEvent,
        fastMa,
        longMa,
        lower,
        profile,
        rsiValues,
        slowMa,
        strategy: input.strategy,
        trix,
        trixSignal,
        upper,
        volumeMa,
      });

      drawdownEvent = signal.drawdownEvent;
      drawupEvent = signal.drawupEvent;

      if (signal.side) {
        const entry = signal.side === 'long' ? candle.close * (1 + slippageRate) : candle.close * (1 - slippageRate);
        const stopDistance = Math.max(atrValue * profile.atrStopMultiplier, candle.close * 0.004);
        const stop = signal.side === 'long' ? entry - stopDistance : entry + stopDistance;
        const riskAmount = Math.max(5, equity * (Math.min(input.strategy.riskPerTrade, 2) / 100));
        const size = riskAmount / Math.abs(entry - stop);

        openTrade = {
          entry,
          entryIndex: index,
          entryTime: isoTime(candle.time),
          riskAmount,
          side: signal.side,
          size,
          stop,
          trail: signal.side === 'long' ? entry - atrValue * profile.atrTrailMultiplier : entry + atrValue * profile.atrTrailMultiplier,
        };
      }
    }

    const markEquity = openTrade ? equity + unrealizedPnl(openTrade, candle.close) : equity;
    equityCurve.push(roundMoney(markEquity));
  }

  const drawdownCurve = buildDrawdownCurve(equityCurve.length ? equityCurve : [input.initialCapital]);
  const buyHoldCurve = buildBuyHoldCurve(candles, input.initialCapital);
  const winningTrades = trades.filter((trade) => trade.status === 'win');
  const losingTrades = trades.filter((trade) => trade.status === 'loss');
  const grossWin = winningTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.pnl, 0));
  const finalEquity = equityCurve[equityCurve.length - 1] ?? equity;
  const netProfit = roundMoney(finalEquity - input.initialCapital);
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const openPosition =
    openTrade && lastCandle
      ? {
          entry: roundMarketValue(openTrade.entry),
          entryTime: openTrade.entryTime,
          markPrice: roundMarketValue(lastCandle.close),
          side: openTrade.side,
          size: roundMarketValue(openTrade.size),
          stop: roundMarketValue(openTrade.stop),
          trail: roundMarketValue(openTrade.trail),
          unrealizedPnl: roundMoney(unrealizedPnl(openTrade, lastCandle.close)),
        }
      : undefined;

  if (openPosition) {
    warnings.push('One position remained open on the last candle; it is marked to market and excluded from closed-trade rows.');
  }

  return {
    buyHoldCurve: downsample(buyHoldCurve, 80),
    buyHoldReturn: buyHoldCurve.length ? roundMoney(((buyHoldCurve[buyHoldCurve.length - 1] - input.initialCapital) / input.initialCapital) * 100) : 0,
    candleCount: candles.length,
    dataWindow:
      firstCandle && lastCandle
        ? {
            candleChecksum: candleChecksum(candles),
            firstCandleAt: isoTime(firstCandle.time),
            lastCandleAt: isoTime(lastCandle.time),
          }
        : undefined,
    drawdown: roundMoney(Math.min(0, ...drawdownCurve)),
    drawdownCurve: downsample(drawdownCurve, 80),
    engine: isJimmyBacktest ? 'jimmy-pine-v5-candle-engine' : 'thoon-concept-candle-engine',
    equityCurve: downsample(equityCurve.length ? equityCurve : [input.initialCapital], 80),
    executionModel: isJimmyBacktest
      ? 'Signals are evaluated from exchange OHLCV candles; entries use candle close with configured slippage, exits use candle high/low against ATR stop, ATR trail, take-profit and MA cross.'
      : 'Thoon concept adaptation: public research concepts are converted into explicit candle rules, then evaluated on exchange OHLCV with configured slippage, ATR risk, trailing stop and take-profit.',
    exchangeId: input.exchangeId,
    exchangeName: input.exchangeName,
    feesPct: input.feesPct,
    generatedAt: new Date().toISOString(),
    id: `bt-calc-${slug(input.strategy.id)}-${slug(input.symbol)}-${slug(input.timeframe)}-${slug(input.period)}-${Date.now()}`,
    initialCapital: input.initialCapital,
    losingTrades: losingTrades.length,
    market: input.symbol,
    marketDataSource: input.marketDataSource,
    monthlyReturns: buildPeriodReturns(equityCurve.length ? equityCurve : [input.initialCapital], input.initialCapital),
    netProfit,
    openPosition,
    period: input.period,
    profitFactor: grossLoss > 0 ? roundMoney(grossWin / grossLoss) : winningTrades.length ? roundMoney(grossWin) : 0,
    slippagePct: input.slippagePct,
    source: 'calculated',
    strategyId: input.strategy.id,
    timeframe: input.timeframe,
    totalTrades: trades.length,
    trades,
    warnings,
    winRate: trades.length ? roundMoney((winningTrades.length / trades.length) * 100) : 0,
    winningTrades: winningTrades.length,
  };
}

function buildBuyHoldCurve(candles: Candle[], initialCapital: number) {
  const firstClose = candles[0]?.close;

  if (!firstClose) {
    return [initialCapital];
  }

  return candles.map((candle) => roundMoney(initialCapital * (candle.close / firstClose)));
}

function entrySignal(input: {
  candleIndex: number;
  candles: Candle[];
  drawdownEvent: boolean;
  drawupEvent: boolean;
  fastMa: number[];
  longMa: number[];
  lower: number[];
  profile: JimmyBacktestProfile;
  rsiValues: number[];
  slowMa: number[];
  strategy: Strategy;
  trix: number[];
  trixSignal: number[];
  upper: number[];
  volumeMa: number[];
}): { drawdownEvent: boolean; drawupEvent: boolean; side?: 'long' | 'short' } {
  const index = input.candleIndex;
  const candle = input.candles[index];
  const previous = input.candles[index - 1];
  const bullish = (input.fastMa[index] ?? 0) > (input.slowMa[index] ?? Infinity);
  const bearish = (input.fastMa[index] ?? Infinity) < (input.slowMa[index] ?? 0);
  const previousUpper = input.upper[index - 1] ?? Infinity;
  const previousLower = input.lower[index - 1] ?? 0;
  const rsiValue = input.rsiValues[index] ?? 50;
  const longMaValue = input.longMa[index];
  const hasLongMa = Number.isFinite(longMaValue);
  const trixCross = (input.trix[index - 1] ?? 0) <= (input.trixSignal[index - 1] ?? 0) && (input.trix[index] ?? 0) > (input.trixSignal[index] ?? 0);
  const trixCrossUnder = (input.trix[index - 1] ?? 0) >= (input.trixSignal[index - 1] ?? 0) && (input.trix[index] ?? 0) < (input.trixSignal[index] ?? 0);
  const drawdownPct = currentDrawdownPct(input.candles, index, input.profile.drawdownLookback);
  let drawdownEvent = input.drawdownEvent || drawdownPct >= input.profile.drawdownThreshold;
  const drawdownRecovery = drawdownEvent && drawdownPct <= input.profile.drawdownRecoveryLevel;
  const drawupPct = currentDrawupPct(input.candles, index, input.profile.drawupLookback);
  let drawupEvent = input.drawupEvent || drawupPct >= input.profile.drawupThreshold;
  const drawupRecovery = drawupEvent && drawupPct <= input.profile.drawupRecoveryLevel;

  if (drawdownRecovery) {
    drawdownEvent = false;
  }

  if (drawupRecovery) {
    drawupEvent = false;
  }

  if (isJimmyStrategy(input.strategy)) {
    const longCondition =
      bullish && ((hasLongMa && trixCross && candle.close > longMaValue) || candle.close > previousUpper || rsiValue < input.profile.rsiOversold || drawdownRecovery);
    const shortCondition =
      bearish && ((hasLongMa && trixCrossUnder && candle.close < longMaValue) || candle.close < previousLower || rsiValue > input.profile.rsiOverbought || drawupRecovery);

    if (longCondition) {
      return { drawdownEvent, drawupEvent, side: 'long' };
    }

    if (shortCondition) {
      return { drawdownEvent, drawupEvent, side: 'short' };
    }

    return { drawdownEvent, drawupEvent };
  }

  if (input.strategy.type === 'breakout') {
    return {
      drawdownEvent,
      drawupEvent,
      side: candle.close > previousUpper && candle.volume > (input.volumeMa[index] ?? 0) ? 'long' : bearish && candle.close < previousLower ? 'short' : undefined,
    };
  }

  if (input.strategy.type === 'mean-reversion') {
    return {
      drawdownEvent,
      drawupEvent,
      side: rsiValue < 35 && candle.close <= previousLower * 1.012 ? 'long' : rsiValue > 68 && candle.close >= previousUpper * 0.988 ? 'short' : undefined,
    };
  }

  const crossedAboveFast = previous.close <= (input.fastMa[index - 1] ?? previous.close) && candle.close > (input.fastMa[index] ?? candle.close);
  const crossedBelowFast = previous.close >= (input.fastMa[index - 1] ?? previous.close) && candle.close < (input.fastMa[index] ?? candle.close);

  return {
    drawdownEvent,
    drawupEvent,
    side: bullish && (crossedAboveFast || candle.close > previousUpper) ? 'long' : bearish && crossedBelowFast ? 'short' : undefined,
  };
}

function evaluateExit(strategy: Strategy, candles: Candle[], index: number, trade: OpenTrade, longMaValue: number | undefined, atrValue: number, slippageRate: number, profile: JimmyBacktestProfile) {
  const candle = candles[index];
  const takeProfitDistance = Math.abs(trade.entry - trade.stop) * (strategy.riskSettings?.rrTarget ?? 2);
  const takeProfit = trade.side === 'long' ? trade.entry + takeProfitDistance : trade.entry - takeProfitDistance;
  const nextTrail = trade.side === 'long' ? candle.close - atrValue * profile.atrTrailMultiplier : candle.close + atrValue * profile.atrTrailMultiplier;

  trade.trail = trade.side === 'long' ? Math.max(trade.trail, nextTrail) : Math.min(trade.trail, nextTrail);

  if (trade.side === 'long') {
    if (candle.low <= trade.stop) {
      return { price: trade.stop * (1 - slippageRate), reason: 'stop-loss' as const };
    }

    if (candle.low <= trade.trail && index > trade.entryIndex + 1) {
      return { price: trade.trail * (1 - slippageRate), reason: 'trailing-stop' as const };
    }

    if (candle.high >= takeProfit) {
      return { price: takeProfit * (1 - slippageRate), reason: 'take-profit' as const };
    }

    if (longMaValue && candle.close < longMaValue && index > trade.entryIndex + 2) {
      return { price: candle.close * (1 - slippageRate), reason: 'ma-cross' as const };
    }
  } else {
    if (candle.high >= trade.stop) {
      return { price: trade.stop * (1 + slippageRate), reason: 'stop-loss' as const };
    }

    if (candle.high >= trade.trail && index > trade.entryIndex + 1) {
      return { price: trade.trail * (1 + slippageRate), reason: 'trailing-stop' as const };
    }

    if (candle.low <= takeProfit) {
      return { price: takeProfit * (1 + slippageRate), reason: 'take-profit' as const };
    }

    if (longMaValue && candle.close > longMaValue && index > trade.entryIndex + 2) {
      return { price: candle.close * (1 + slippageRate), reason: 'ma-cross' as const };
    }
  }

  return undefined;
}

function closeTrade(strategyId: string, candles: Candle[], trade: OpenTrade, exitIndex: number, exit: number, exitReason: BacktestTrade['exitReason'], feeRate: number): BacktestTrade {
  const gross = unrealizedPnl(trade, exit);
  const fee = Math.abs(trade.entry * trade.size * feeRate) + Math.abs(exit * trade.size * feeRate);
  const pnl = roundMoney(gross - fee);

  return {
    entry: roundMarketValue(trade.entry),
    entryTime: trade.entryTime,
    exit: roundMarketValue(exit),
    exitReason,
    exitTime: isoTime(candles[exitIndex].time),
    fee: roundMoney(fee),
    id: `bt-trade-${slug(strategyId)}-${trade.entryIndex}-${exitIndex}`,
    pnl,
    rMultiple: roundMoney(pnl / Math.max(trade.riskAmount, 1)),
    side: trade.side,
    size: roundMarketValue(trade.size),
    status: pnl >= 0 ? 'win' : 'loss',
  };
}

function unrealizedPnl(trade: OpenTrade, price: number) {
  return trade.side === 'long' ? (price - trade.entry) * trade.size : (trade.entry - price) * trade.size;
}

function selectPeriodCandles(candles: Candle[], period: string, timeframe: Timeframe) {
  const days = period === '30D' ? 30 : period === '180D' ? 180 : period === '1Y' ? 365 : 90;
  const minutes = timeframeMinutes(timeframe);
  const maxCandles = Math.ceil((days * 24 * 60) / minutes);

  return candles.slice(-Math.min(candles.length, Math.max(40, maxCandles)));
}

function timeframeMinutes(timeframe: Timeframe) {
  const map: Record<Timeframe, number> = {
    '1M': 43200,
    '1d': 1440,
    '1h': 60,
    '1m': 1,
    '1w': 10080,
    '1y': 525600,
    '2h': 120,
    '4h': 240,
    '5m': 5,
    '15m': 15,
    '30m': 30,
  };

  return map[timeframe] ?? 15;
}

function sma(values: number[], length: number) {
  return values.map((_, index) => {
    if (index + 1 < length) {
      return Number.NaN;
    }

    const slice = values.slice(index + 1 - length, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / length;
  });
}

function ema(values: number[], length: number) {
  const multiplier = 2 / (length + 1);
  const output: number[] = [];

  values.forEach((value, index) => {
    output[index] = index === 0 ? value : value * multiplier + output[index - 1] * (1 - multiplier);
  });

  return output;
}

function trixSeries(values: number[], length: number) {
  const ema1 = ema(values, length);
  const ema2 = ema(ema1, length);
  const ema3 = ema(ema2, length);

  return ema3.map((value, index) => {
    const previous = ema3[index - 1];
    return previous ? ((value - previous) / previous) * 100 : 0;
  });
}

function rsi(values: number[], length: number) {
  const output = Array.from({ length: values.length }, () => Number.NaN);
  let avgGain = 0;
  let avgLoss = 0;

  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);

    if (index <= length) {
      avgGain += gain;
      avgLoss += loss;
      if (index === length) {
        avgGain /= length;
        avgLoss /= length;
      }
    } else {
      avgGain = (avgGain * (length - 1) + gain) / length;
      avgLoss = (avgLoss * (length - 1) + loss) / length;
      output[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }

  return output;
}

function atr(candles: Candle[], length: number) {
  const trueRanges = candles.map((candle, index) => {
    const previousClose = candles[index - 1]?.close ?? candle.close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });

  return ema(trueRanges, length);
}

function rollingMax(values: number[], length: number) {
  return values.map((_, index) => Math.max(...values.slice(Math.max(0, index + 1 - length), index + 1)));
}

function rollingMin(values: number[], length: number) {
  return values.map((_, index) => Math.min(...values.slice(Math.max(0, index + 1 - length), index + 1)));
}

function currentDrawdownPct(candles: Candle[], index: number, lookback: number) {
  const slice = candles.slice(Math.max(0, index + 1 - lookback), index + 1);
  const highest = Math.max(...slice.map((candle) => candle.close));
  return highest ? ((highest - candles[index].close) / highest) * 100 : 0;
}

function currentDrawupPct(candles: Candle[], index: number, lookback: number) {
  const slice = candles.slice(Math.max(0, index + 1 - lookback), index + 1);
  const lowest = Math.min(...slice.map((candle) => candle.close));
  return lowest ? ((candles[index].close - lowest) / lowest) * 100 : 0;
}

function isJimmyStrategy(strategy: Strategy) {
  return strategy.id === JIMMY_STRATEGY_ID || strategy.agentSource?.sourceId === JIMMY_SOURCE_ID;
}

function jimmyProfileFor(timeframe: Timeframe): JimmyBacktestProfile {
  const base: JimmyBacktestProfile = {
    atrLength: 14,
    atrStopMultiplier: 1.5,
    atrTrailMultiplier: 2,
    donchianLength: 20,
    drawdownLookback: 50,
    drawdownRecoveryLevel: 5,
    drawdownThreshold: 10,
    drawupLookback: 50,
    drawupRecoveryLevel: 5,
    drawupThreshold: 10,
    fastMaLength: 20,
    longMaLength: 200,
    rsiLength: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
    slowMaLength: 50,
    trixLength: 8,
    trixSignalLength: 15,
  };

  if (timeframe === '1m' || timeframe === '5m') {
    return {
      ...base,
      atrStopMultiplier: 1.8,
      atrTrailMultiplier: 2.4,
      donchianLength: 24,
      rsiOverbought: 72,
      rsiOversold: 28,
      trixLength: 10,
      trixSignalLength: 18,
    };
  }

  if (timeframe === '4h' || timeframe === '1d' || timeframe === '1w' || timeframe === '1M' || timeframe === '1y') {
    return {
      ...base,
      atrStopMultiplier: 1.4,
      donchianLength: 18,
      trixLength: 6,
      trixSignalLength: 12,
    };
  }

  return base;
}

function buildDrawdownCurve(values: number[]) {
  let peak = values[0] ?? 0;

  return downsample(
    values.map((value) => {
      peak = Math.max(peak, value);
      return peak ? roundMoney(((value - peak) / peak) * 100) : 0;
    }),
    34,
  );
}

function buildPeriodReturns(values: number[], initialCapital: number) {
  const labels = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const chunkSize = Math.max(1, Math.floor(values.length / labels.length));

  return labels.map((label, index) => {
    const start = values[index * chunkSize] ?? initialCapital;
    const end = values[Math.min(values.length - 1, (index + 1) * chunkSize - 1)] ?? start;

    return { label, value: start ? roundMoney(((end - start) / start) * 100) : 0 };
  });
}

function downsample(values: number[], target: number) {
  if (values.length <= target) {
    return values.map(roundMoney);
  }

  return Array.from({ length: target }, (_, index) => {
    const sourceIndex = Math.round((index / (target - 1)) * (values.length - 1));
    return roundMoney(values[sourceIndex]);
  });
}

function isoTime(time: number) {
  return new Date(time * 1000).toISOString();
}

function candleChecksum(candles: Candle[]) {
  let hash = 2166136261;

  for (const candle of candles) {
    const row = `${candle.time}:${candle.open}:${candle.high}:${candle.low}:${candle.close}:${candle.volume}`;

    for (let index = 0; index < row.length; index += 1) {
      hash ^= row.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundMarketValue(value: number) {
  if (Math.abs(value) >= 1000) {
    return Math.round(value * 100) / 100;
  }

  if (Math.abs(value) >= 1) {
    return Math.round(value * 10000) / 10000;
  }

  return Math.round(value * 1000000) / 1000000;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}
