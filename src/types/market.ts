export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w' | '1M' | '1y';

export type MarketCategory = 'all' | 'trending' | 'defi' | 'layer-1' | 'meme' | 'ai';

export type MarketOverview = {
  activeCryptos: number;
  btcDominance: number;
  ethDominance: number;
  marketCap: number;
  sentiment: string;
  volume24h: number;
};

export type MarketDataStatus = {
  baseUrl: string;
  live: boolean;
  pairCount: number;
  provider: 'binance' | 'bud' | 'local';
  updatedAt: string;
  warnings: string[];
};

export type MarketDataSnapshot = {
  overview: MarketOverview;
  pairs: MarketPair[];
  status: MarketDataStatus;
};

export type PositionDraft = {
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskPercent: number;
  size: number;
};

export type MarketPair = {
  id: string;
  symbol: string;
  name: string;
  base: string;
  quote: string;
  exchange: string;
  category: Exclude<MarketCategory, 'all'>;
  lastPrice: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  dominance?: number;
  status: 'paper' | 'live-disabled';
  timeframe: Timeframe;
  candles: Candle[];
  draft: PositionDraft;
};
