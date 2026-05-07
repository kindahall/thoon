import type { MarketPair } from '../types/market';

const btcCandles = buildCandles([
  66680, 67180, 66940, 67560, 67220, 68440, 67990, 68820, 68280, 69480, 68940, 70140,
  69680, 70840, 70360, 69940, 69210, 69760, 68840, 68420, 67680, 68120, 67380, 66940,
  66420, 67160, 66280, 65720, 65180, 64640, 64180, 64860, 63920, 63480, 62980, 62580,
  62160, 62780, 61880, 61460, 61080, 61860, 61320, 62380, 62960, 62140, 61680, 62620,
  63540, 63180, 64140, 64780, 65320, 64880, 65840, 66420, 66120, 67180, 67820, 67347.6,
]);

export const marketPairs: MarketPair[] = [
  {
    id: 'btc-usdt',
    symbol: 'BTC/USDT',
    name: 'Bitcoin',
    base: 'BTC',
    quote: 'USDT',
    exchange: 'Binance',
    category: 'trending',
    lastPrice: 67347.6,
    change24h: 1.92,
    volume24h: 28160000000,
    marketCap: 1327000000000,
    dominance: 52.41,
    status: 'paper',
    timeframe: '15m',
    candles: btcCandles,
    draft: {
      direction: 'long',
      entry: 67347.6,
      stopLoss: 65940,
      takeProfit: 70800,
      riskPercent: 1,
      size: 0.148,
    },
  },
  {
    id: 'eth-usdt',
    symbol: 'ETH/USDT',
    name: 'Ethereum',
    base: 'ETH',
    quote: 'USDT',
    exchange: 'Bybit',
    category: 'layer-1',
    lastPrice: 3482.18,
    change24h: 2.34,
    volume24h: 14480000000,
    marketCap: 418600000000,
    dominance: 16.52,
    status: 'paper',
    timeframe: '15m',
    candles: buildCandles([
      3364, 3390, 3378, 3412, 3398, 3436, 3420, 3462, 3444, 3492, 3478, 3516, 3502, 3538,
      3510, 3496, 3464, 3488, 3454, 3438, 3408, 3426, 3398, 3382, 3360, 3394, 3358, 3336,
      3318, 3294, 3280, 3308, 3272, 3256, 3238, 3226, 3210, 3246, 3208, 3192, 3184, 3224,
      3210, 3262, 3288, 3254, 3234, 3282, 3318, 3306, 3348, 3376, 3404, 3386, 3430, 3458,
      3444, 3472, 3494, 3482.18,
    ]),
    draft: {
      direction: 'long',
      entry: 3482.18,
      stopLoss: 3406,
      takeProfit: 3650,
      riskPercent: 0.85,
      size: 2.4,
    },
  },
  {
    id: 'sol-usdt',
    symbol: 'SOL/USDT',
    name: 'Solana',
    base: 'SOL',
    quote: 'USDT',
    exchange: 'OKX',
    category: 'layer-1',
    lastPrice: 182.44,
    change24h: -0.84,
    volume24h: 3920000000,
    marketCap: 83800000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildCandles([
      188, 187.2, 188.4, 186.8, 185.9, 187.6, 186.2, 184.9, 185.8, 183.9, 184.7, 182.8,
      181.9, 183.2, 182.4, 181.6, 180.8, 181.7, 180.2, 179.6, 178.8, 180.4, 179.8, 181.2,
      180.6, 182.1, 181.4, 180.2, 179.5, 178.9, 179.8, 181.4, 180.8, 182.6, 183.7, 182.9,
      184.1, 183.2, 181.8, 180.6, 181.1, 182.8, 181.9, 183.4, 184.8, 183.6, 182.2, 183.1,
      184.6, 183.8, 182.9, 181.7, 182.44,
    ]),
    draft: {
      direction: 'short',
      entry: 182.44,
      stopLoss: 187.2,
      takeProfit: 173.6,
      riskPercent: 0.75,
      size: 28,
    },
  },
  {
    id: 'link-usdt',
    symbol: 'LINK/USDT',
    name: 'Chainlink',
    base: 'LINK',
    quote: 'USDT',
    exchange: 'Bitget',
    category: 'defi',
    lastPrice: 18.42,
    change24h: 4.18,
    volume24h: 812000000,
    marketCap: 11200000000,
    status: 'live-disabled',
    timeframe: '15m',
    candles: buildCandles([
      17.44, 17.62, 17.58, 17.74, 17.7, 17.92, 17.86, 18.08, 18.0, 18.18, 18.06, 18.28,
      18.22, 18.4, 18.34, 18.26, 18.12, 18.2, 18.08, 17.98, 17.84, 17.96, 17.9, 18.06,
      18.14, 18.04, 18.22, 18.3, 18.18, 18.34, 18.48, 18.42,
    ]),
    draft: {
      direction: 'long',
      entry: 18.42,
      stopLoss: 17.86,
      takeProfit: 19.8,
      riskPercent: 1,
      size: 420,
    },
  },
  {
    id: 'bnb-usdt',
    symbol: 'BNB/USDT',
    name: 'BNB',
    base: 'BNB',
    quote: 'USDT',
    exchange: 'Binance',
    category: 'layer-1',
    lastPrice: 593.22,
    change24h: 1.14,
    volume24h: 1920000000,
    marketCap: 86540000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildSyntheticCandles(593.22, 1.14, 7),
    draft: {
      direction: 'long',
      entry: 593.22,
      stopLoss: 579.4,
      takeProfit: 624,
      riskPercent: 0.8,
      size: 12,
    },
  },
  {
    id: 'xrp-usdt',
    symbol: 'XRP/USDT',
    name: 'XRP',
    base: 'XRP',
    quote: 'USDT',
    exchange: 'Bybit',
    category: 'trending',
    lastPrice: 0.5241,
    change24h: 2.31,
    volume24h: 1560000000,
    marketCap: 28720000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildSyntheticCandles(0.5241, 2.31, 13),
    draft: {
      direction: 'long',
      entry: 0.5241,
      stopLoss: 0.509,
      takeProfit: 0.558,
      riskPercent: 0.7,
      size: 8800,
    },
  },
  {
    id: 'doge-usdt',
    symbol: 'DOGE/USDT',
    name: 'Dogecoin',
    base: 'DOGE',
    quote: 'USDT',
    exchange: 'OKX',
    category: 'meme',
    lastPrice: 0.1524,
    change24h: -1.23,
    volume24h: 1080000000,
    marketCap: 21820000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildSyntheticCandles(0.1524, -1.23, 19),
    draft: {
      direction: 'short',
      entry: 0.1524,
      stopLoss: 0.158,
      takeProfit: 0.141,
      riskPercent: 0.5,
      size: 24000,
    },
  },
  {
    id: 'rndr-usdt',
    symbol: 'RNDR/USDT',
    name: 'Render',
    base: 'RNDR',
    quote: 'USDT',
    exchange: 'Coinbase Advanced',
    category: 'ai',
    lastPrice: 8.74,
    change24h: 8.91,
    volume24h: 642000000,
    marketCap: 4380000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildSyntheticCandles(8.74, 8.91, 23),
    draft: {
      direction: 'long',
      entry: 8.74,
      stopLoss: 8.22,
      takeProfit: 10.2,
      riskPercent: 0.75,
      size: 610,
    },
  },
  {
    id: 'fet-usdt',
    symbol: 'FET/USDT',
    name: 'Fetch.ai',
    base: 'FET',
    quote: 'USDT',
    exchange: 'KuCoin',
    category: 'ai',
    lastPrice: 2.48,
    change24h: 7.32,
    volume24h: 428000000,
    marketCap: 2520000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildSyntheticCandles(2.48, 7.32, 29),
    draft: {
      direction: 'long',
      entry: 2.48,
      stopLoss: 2.32,
      takeProfit: 2.92,
      riskPercent: 0.85,
      size: 1800,
    },
  },
  {
    id: 'near-usdt',
    symbol: 'NEAR/USDT',
    name: 'NEAR Protocol',
    base: 'NEAR',
    quote: 'USDT',
    exchange: 'Bitget',
    category: 'layer-1',
    lastPrice: 7.03,
    change24h: 6.21,
    volume24h: 548000000,
    marketCap: 7920000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildSyntheticCandles(7.03, 6.21, 31),
    draft: {
      direction: 'long',
      entry: 7.03,
      stopLoss: 6.68,
      takeProfit: 7.86,
      riskPercent: 0.8,
      size: 760,
    },
  },
  {
    id: 'matic-usdt',
    symbol: 'MATIC/USDT',
    name: 'Polygon',
    base: 'MATIC',
    quote: 'USDT',
    exchange: 'Kraken',
    category: 'defi',
    lastPrice: 0.86,
    change24h: 5.15,
    volume24h: 392000000,
    marketCap: 8510000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildSyntheticCandles(0.86, 5.15, 37),
    draft: {
      direction: 'long',
      entry: 0.86,
      stopLoss: 0.82,
      takeProfit: 0.96,
      riskPercent: 0.5,
      size: 4800,
    },
  },
  {
    id: 'avax-usdt',
    symbol: 'AVAX/USDT',
    name: 'Avalanche',
    base: 'AVAX',
    quote: 'USDT',
    exchange: 'Binance',
    category: 'layer-1',
    lastPrice: 35.21,
    change24h: 2.88,
    volume24h: 734000000,
    marketCap: 14200000000,
    status: 'paper',
    timeframe: '15m',
    candles: buildSyntheticCandles(35.21, 2.88, 41),
    draft: {
      direction: 'long',
      entry: 35.21,
      stopLoss: 33.8,
      takeProfit: 38.6,
      riskPercent: 0.75,
      size: 132,
    },
  },
];

export const marketOverview = {
  activeCryptos: 12842,
  btcDominance: 52.41,
  ethDominance: 16.52,
  marketCap: 2480000000000,
  sentiment: 'Risk-on',
  volume24h: 98620000000,
};

function buildCandles(closes: number[]) {
  const startTime = Date.UTC(2024, 4, 16, 18, 0, 0) / 1000;
  const chartCloses = closes.length < 120 ? densifyCloses(closes, closes.length > 48 ? 3 : 4) : closes;
  let previous = chartCloses[0] * 0.996;

  return chartCloses.map((close, index) => {
    const open = previous;
    const body = Math.abs(close - open);
    const scale = Math.max(close * 0.0014, 0.0008);
    const impulse = 0.72 + (((index * 37) % 180) / 220);
    const upperWick = scale * impulse + body * 0.16;
    const lowerWick = scale * (1.08 - impulse / 3) + body * 0.12;
    const high = Math.max(open, close) + upperWick;
    const low = Math.min(open, close) - lowerWick;
    const volume = 3600 + ((index * 977) % 7600) + Math.round(body * 12);

    previous = close;

    return {
      time: startTime + index * 15 * 60,
      open,
      high: roundMarketValue(high),
      low: roundMarketValue(low),
      close,
      volume,
    };
  });
}

function densifyCloses(closes: number[], steps: number) {
  return closes.reduce<number[]>((values, close, index) => {
    if (index === 0) {
      values.push(roundMarketValue(close));
      return values;
    }

    const previous = closes[index - 1];
    const move = close - previous;

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const wave = Math.sin(index * 1.73 + step * 0.91) * Math.abs(move) * 0.18;
      const microMove = Math.cos(index * 0.67 + step * 1.41) * close * 0.00055;
      const value = step === steps ? close : previous + move * progress + wave + microMove;
      values.push(roundMarketValue(value));
    }

    return values;
  }, []);
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

function buildSyntheticCandles(lastPrice: number, change24h: number, seed: number) {
  const startPrice = lastPrice / (1 + change24h / 100);
  const closes = Array.from({ length: 56 }, (_, index) => {
    const progress = index / 55;
    const wave = Math.sin((index + seed) * 0.62) * lastPrice * 0.009;
    const pulse = Math.cos((index * seed) / 17) * lastPrice * 0.004;
    const trend = startPrice + (lastPrice - startPrice) * progress;

    if (index === 55) {
      return lastPrice;
    }

    return Math.max(trend + wave + pulse, lastPrice * 0.72);
  });

  return buildCandles(closes);
}
