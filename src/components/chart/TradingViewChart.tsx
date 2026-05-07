'use client';

import { useEffect, useId, useMemo, useState } from 'react';

import { useTheme } from '../../hooks/useTheme';
import type { Timeframe } from '../../types/market';

type TradingViewChartProps = {
  exchangeId: string;
  marketType: 'spot' | 'perpetual' | 'futures';
  symbol: string;
  timeframe: Timeframe;
};

type TradingViewWidgetInstance = {
  remove?: () => void;
};

type TradingViewFactory = {
  widget: new (options: Record<string, unknown>) => TradingViewWidgetInstance;
};

declare global {
  interface Window {
    TradingView?: TradingViewFactory;
  }
}

const tradingViewScriptId = 'tradingview-widget-script';

export function TradingViewChart({ exchangeId, marketType, symbol, timeframe }: TradingViewChartProps) {
  const reactId = useId();
  const containerId = useMemo(() => `tradingview_${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId]);
  const { resolvedTheme } = useTheme();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const tradingViewSymbol = useMemo(() => toTradingViewSymbol(symbol, exchangeId, marketType), [exchangeId, marketType, symbol]);

  useEffect(() => {
    let cancelled = false;
    const container = document.getElementById(containerId);

    setLoadState('loading');

    if (container) {
      container.innerHTML = '';
    }

    loadTradingViewScript()
      .then(() => {
        if (cancelled || !window.TradingView?.widget) {
          return;
        }

        new window.TradingView.widget({
          allow_symbol_change: true,
          autosize: true,
          backgroundColor: resolvedTheme === 'light' ? '#f7fbff' : '#06111f',
          calendar: false,
          container_id: containerId,
          details: true,
          enable_publishing: false,
          gridColor: resolvedTheme === 'light' ? 'rgba(3, 117, 164, 0.13)' : 'rgba(116, 207, 255, 0.11)',
          hide_side_toolbar: false,
          interval: toTradingViewInterval(timeframe),
          locale: 'fr',
          save_image: true,
          studies: ['MASimple@tv-basicstudies'],
          style: '1',
          support_host: 'https://www.tradingview.com',
          symbol: tradingViewSymbol,
          theme: resolvedTheme,
          timezone: 'Etc/UTC',
          toolbar_bg: resolvedTheme === 'light' ? '#eef8ff' : '#071524',
          withdateranges: true,
        });
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [containerId, resolvedTheme, timeframe, tradingViewSymbol]);

  return (
    <div className="tradingview-chart" aria-label={`${symbol} TradingView chart`}>
      {loadState !== 'ready' ? (
        <div className={`tradingview-chart__state tradingview-chart__state--${loadState}`}>
          <strong>{loadState === 'error' ? 'TradingView indisponible' : 'TradingView charge le chart'}</strong>
          <span>{tradingViewSymbol} · {timeframeLabel(timeframe)}</span>
        </div>
      ) : null}
      <div className="tradingview-chart__container" id={containerId} />
    </div>
  );
}

function loadTradingViewScript() {
  if (window.TradingView?.widget) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(tradingViewScriptId) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('TradingView script failed')), { once: true });
      return;
    }

    const script = document.createElement('script');

    script.async = true;
    script.id = tradingViewScriptId;
    script.src = 'https://s3.tradingview.com/tv.js';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('TradingView script failed')), { once: true });
    document.head.appendChild(script);
  });
}

function toTradingViewInterval(timeframe: Timeframe) {
  const intervals: Record<Timeframe, string> = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '1d': 'D',
    '1w': 'W',
    '1M': 'M',
    '1y': '12M',
  };

  return intervals[timeframe];
}

function toTradingViewSymbol(symbol: string, exchangeId: string, marketType: TradingViewChartProps['marketType']) {
  const [rawBase = 'BTC', rawQuote = 'USDT'] = symbol.split('/');
  const prefix = exchangePrefixes[exchangeId] ?? 'BINANCE';
  const base = normalizeBase(rawBase, exchangeId);
  const quote = normalizeQuote(rawQuote, exchangeId);
  const supportsPerpetualSuffix = ['binance', 'bybit', 'okx', 'bitget'].includes(exchangeId);
  const suffix = marketType !== 'spot' && supportsPerpetualSuffix ? '.P' : '';

  return `${prefix}:${base}${quote}${suffix}`;
}

function normalizeBase(base: string, exchangeId: string) {
  const normalizedBase = base.toUpperCase();

  if (exchangeId === 'kraken' && normalizedBase === 'BTC') {
    return 'XBT';
  }

  if (normalizedBase === 'RNDR') {
    return 'RENDER';
  }

  return normalizedBase;
}

function normalizeQuote(quote: string, exchangeId: string) {
  const normalizedQuote = quote.toUpperCase();

  if ((exchangeId === 'coinbase-advanced' || exchangeId === 'coinbase') && normalizedQuote === 'USDT') {
    return 'USD';
  }

  return normalizedQuote;
}

function timeframeLabel(timeframe: Timeframe) {
  return timeframe === '1y' ? '1Y' : timeframe;
}

const exchangePrefixes: Record<string, string> = {
  binance: 'BINANCE',
  bitget: 'BITGET',
  bybit: 'BYBIT',
  coinbase: 'COINBASE',
  'coinbase-advanced': 'COINBASE',
  kraken: 'KRAKEN',
  kucoin: 'KUCOIN',
  okx: 'OKX',
};
