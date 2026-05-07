'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { MarketDataStatus, MarketPair } from '../types/market';

type BinanceCombinedMessage = {
  data?: BinanceTickerPayload | BinanceTradePayload;
  stream?: string;
};

type BinanceTickerPayload = {
  E: number;
  P: string;
  c: string;
  e: '24hrTicker';
  q: string;
  s: string;
};

type BinanceTradePayload = {
  E: number;
  e: 'trade';
  p: string;
  q: string;
  s: string;
};

type LiveMarketState = {
  connected: boolean;
  lastEventAt?: number;
  pairs: MarketPair[];
};

const binanceStreamBaseUrl = 'wss://data-stream.binance.vision/stream?streams=';
const liveCommitDelayMs = 200;
const symbolAliases: Record<string, string> = {
  'RNDR/USDT': 'RENDERUSDT',
};

export function useBinanceLiveMarkets(initialPairs: MarketPair[], initialStatus?: MarketDataStatus) {
  const [state, setState] = useState<LiveMarketState>({ connected: Boolean(initialStatus?.live), pairs: initialPairs });
  const latestPairsRef = useRef(initialPairs);
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventAtRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(false);
  const pairSeedKey = useMemo(() => buildPairSeedKey(initialPairs), [initialPairs]);
  const streamSymbolsKey = useMemo(() => buildStreamSymbolsKey(initialPairs), [initialPairs]);
  const symbolMap = useMemo(() => buildSymbolMap(initialPairs), [streamSymbolsKey]);
  const streamUrl = useMemo(() => buildStreamUrl(initialPairs), [streamSymbolsKey]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
        commitTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    latestPairsRef.current = initialPairs;
    setState((current) => (sameMarketPairs(current.pairs, initialPairs) ? current : { ...current, pairs: initialPairs }));
  }, [pairSeedKey]);

  useEffect(() => {
    if (!streamUrl || typeof WebSocket === 'undefined') {
      return undefined;
    }

    const socket = new WebSocket(streamUrl);

    socket.addEventListener('open', () => {
      setState((current) => (current.connected ? current : { ...current, connected: true }));
    });

    socket.addEventListener('message', (event) => {
      const message = parseMessage(event.data);
      const payload = message?.data;

      if (!payload) {
        return;
      }

      const appSymbol = symbolMap.get(payload.s);

      if (!appSymbol) {
        return;
      }

      const price = payload.e === 'trade' ? Number(payload.p) : Number(payload.c);
      const change24h = payload.e === '24hrTicker' ? Number(payload.P) : undefined;
      const volume24h = payload.e === '24hrTicker' ? Number(payload.q) : undefined;

      if (!Number.isFinite(price)) {
        return;
      }

      let hasChanged = false;
      latestPairsRef.current = latestPairsRef.current.map((pair) => {
        if (pair.symbol !== appSymbol) {
          return pair;
        }

        const nextPair = applyLivePrice(pair, price, change24h, volume24h);
        hasChanged ||= nextPair !== pair;

        return nextPair;
      });

      if (hasChanged) {
        scheduleCommit(payload.E);
      }
    });

    socket.addEventListener('close', () => {
      setState((current) => (current.connected ? { ...current, connected: false } : current));
    });

    socket.addEventListener('error', () => {
      setState((current) => (current.connected ? { ...current, connected: false } : current));
    });

    return () => {
      socket.close();

      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
        commitTimeoutRef.current = null;
      }
    };
  }, [streamUrl, symbolMap]);

  function scheduleCommit(lastEventAt: number) {
    lastEventAtRef.current = lastEventAt;

    if (commitTimeoutRef.current !== null) {
      return;
    }

    commitTimeoutRef.current = setTimeout(() => {
      commitTimeoutRef.current = null;

      if (!mountedRef.current) {
        return;
      }

      setState((current) => {
        const nextPairs = latestPairsRef.current;
        const nextLastEventAt = lastEventAtRef.current;

        if (current.connected && current.lastEventAt === nextLastEventAt && current.pairs === nextPairs) {
          return current;
        }

        return {
          connected: true,
          lastEventAt: nextLastEventAt,
          pairs: nextPairs,
        };
      });
    }, liveCommitDelayMs);
  }

  return state;
}

function buildStreamUrl(pairs: MarketPair[]) {
  const streams = pairs.flatMap((pair) => {
    const symbol = toBinanceSymbol(pair.symbol).toLowerCase();

    return [`${symbol}@trade`, `${symbol}@ticker`];
  });

  return streams.length ? `${binanceStreamBaseUrl}${streams.join('/')}` : '';
}

function buildSymbolMap(pairs: MarketPair[]) {
  return new Map(pairs.map((pair) => [toBinanceSymbol(pair.symbol), pair.symbol]));
}

function buildPairSeedKey(pairs: MarketPair[]) {
  return pairs.map((pair) => `${pair.symbol}:${pair.lastPrice}:${pair.change24h}:${pair.volume24h}`).join('|');
}

function buildStreamSymbolsKey(pairs: MarketPair[]) {
  return pairs.map((pair) => toBinanceSymbol(pair.symbol)).join('|');
}

function sameMarketPairs(currentPairs: MarketPair[], nextPairs: MarketPair[]) {
  if (currentPairs === nextPairs) {
    return true;
  }

  if (currentPairs.length !== nextPairs.length) {
    return false;
  }

  return currentPairs.every((pair, index) => {
    const nextPair = nextPairs[index];

    return pair.symbol === nextPair.symbol && pair.lastPrice === nextPair.lastPrice && pair.change24h === nextPair.change24h && pair.volume24h === nextPair.volume24h;
  });
}

function parseMessage(value: unknown): BinanceCombinedMessage | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(value) as BinanceCombinedMessage;
  } catch {
    return undefined;
  }
}

function applyLivePrice(pair: MarketPair, lastPrice: number, change24h?: number, volume24h?: number): MarketPair {
  const marketCap = pair.marketCap && pair.lastPrice ? pair.marketCap * (lastPrice / pair.lastPrice) : pair.marketCap;
  const nextChange24h = typeof change24h === 'number' && Number.isFinite(change24h) ? change24h : pair.change24h;
  const nextVolume24h = typeof volume24h === 'number' && Number.isFinite(volume24h) ? volume24h : pair.volume24h;

  if (pair.lastPrice === lastPrice && pair.change24h === nextChange24h && pair.volume24h === nextVolume24h) {
    return pair;
  }

  return {
    ...pair,
    change24h: nextChange24h,
    lastPrice,
    marketCap,
    volume24h: nextVolume24h,
  };
}

function toBinanceSymbol(symbol: string) {
  return symbolAliases[symbol] ?? symbol.replace('/', '').toUpperCase();
}
