import { JIMMY_SOURCE_ID, JIMMY_STRATEGY_ID, JIMMY_STRATEGY_NAME } from '../config/jimmy-strategy';
import type { BacktestReport, Strategy } from '../types/trading';
import { jimmyPineSource } from './core-strategy-pine';

export const strategies: Strategy[] = [
  {
    agentSource: {
      directionBias: 'both',
      language: 'pine-v5',
      originalTimeframe: '1h',
      parameters: [
        { label: 'Long MA', value: 'SMA/EMA 200' },
        { label: 'TRIX', value: '8 / signal 15' },
        { label: 'MA trend', value: 'EMA 20 / EMA 50' },
        { label: 'Donchian', value: '20 breakout' },
        { label: 'RSI', value: '14 oversold 30 / overbought 70' },
        { label: 'ATR exits', value: 'SL 1.5x / trail 2.0x' },
        { label: 'Recovery', value: 'DD/DU 10% -> 5%' },
        { label: 'Codex adaptation', value: 'Tune only inputs per symbol/timeframe; never replace jimmy logic.' },
      ],
      protectedCore: true,
      sourceCode: jimmyPineSource,
      sourceId: JIMMY_SOURCE_ID,
      summary:
        'Protected Pine v5 core strategy: TRIX, Donchian, RSI, ATR exits, drawdown long recovery and drawup short recovery. Codex may adapt parameters by crypto and timeframe, while other named strategies remain separate records.',
    },
    entryConditions: [
      { connector: 'IF', field: 'TRIX Long', id: 'jimmy-entry-long-trix', operator: 'crosses-above', value: 'TRIX crosses signal while close > MA 200' },
      { connector: 'OR', field: 'Donchian Long', id: 'jimmy-entry-long-donchian', operator: 'greater-than', value: 'Close breaks upper 20 with EMA 20 > EMA 50' },
      { connector: 'OR', field: 'RSI Long', id: 'jimmy-entry-long-rsi', operator: 'less-than', value: 'RSI 14 below 30 with bullish trend' },
      { connector: 'OR', field: 'Drawdown Long', id: 'jimmy-entry-long-dd', operator: 'less-than', value: 'Recovery from 10% drawdown to 5%' },
      { connector: 'OR', field: 'TRIX Short', id: 'jimmy-entry-short-trix', operator: 'crosses-below', value: 'TRIX crosses below signal while close < MA 200' },
      { connector: 'OR', field: 'Donchian Short', id: 'jimmy-entry-short-donchian', operator: 'less-than', value: 'Close breaks lower 20 with EMA 20 < EMA 50' },
      { connector: 'OR', field: 'RSI Short', id: 'jimmy-entry-short-rsi', operator: 'greater-than', value: 'RSI 14 above 70 with bearish trend' },
      { connector: 'OR', field: 'Drawup Short', id: 'jimmy-entry-short-du', operator: 'less-than', value: 'Recovery from 10% drawup to 5%' },
    ],
    exitConditions: [
      { connector: 'IF', field: 'ATR Stop', id: 'jimmy-exit-atr-stop', operator: 'less-than', value: 'Long entry - 1.5 ATR / short entry + 1.5 ATR' },
      { connector: 'OR', field: 'ATR Trail', id: 'jimmy-exit-atr-trail', operator: 'greater-than', value: '2 ATR trailing offset' },
      { connector: 'OR', field: 'MA Cross', id: 'jimmy-exit-ma-cross', operator: 'crosses-below', value: 'Long closes below MA 200 / short closes above MA 200' },
    ],
    id: JIMMY_STRATEGY_ID,
    market: 'BTC/USDT',
    name: JIMMY_STRATEGY_NAME,
    performance30d: 0,
    positionDraft: {
      direction: 'long',
      entry: 79860,
      riskPercent: 0.8,
      size: 0.12,
      stopLoss: 78240,
      takeProfit: 83200,
    },
    riskPerTrade: 0.8,
    riskSettings: {
      accountBalance: 10000,
      maxOpenTrades: 5,
      positionSizing: 'risk-percent',
      rrTarget: 2,
      stopLoss: 'ATR 1.5x required',
      stopRequired: true,
      takeProfit: 'ATR trailing + MA 200 exit',
      trailingStop: true,
    },
    setupSnapshot: {
      notes:
        'jimmy is the protected core strategy in Thoon. Codex can create named strategy records and variants, but the original Pine source stays protected.',
    },
    status: 'active',
    timeframe: '1h',
    type: 'trend',
    updatedAt: '2026-05-08T00:00:00.000Z',
  },
];

export const backtestReports: BacktestReport[] = [];
