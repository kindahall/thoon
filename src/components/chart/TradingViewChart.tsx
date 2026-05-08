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
  const [loadState, setLoadState] = useState<'iframe' | 'loading' | 'ready'>('loading');
  const tradingViewSymbol = useMemo(() => toTradingViewSymbol(symbol, exchangeId, marketType), [exchangeId, marketType, symbol]);
  const embedUrl = useMemo(() => buildTradingViewEmbedUrl(tradingViewSymbol, timeframe, resolvedTheme), [resolvedTheme, timeframe, tradingViewSymbol]);

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
          setLoadState('iframe');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [containerId, resolvedTheme, timeframe, tradingViewSymbol]);

  return (
    <div className={`tradingview-chart tradingview-chart--${loadState}`} aria-label={`${symbol} TradingView chart`}>
      {loadState === 'loading' ? (
        <div className={`tradingview-chart__state tradingview-chart__state--${loadState}`}>
          <strong>TradingView charge le chart</strong>
          <span>{tradingViewSymbol} · {timeframeLabel(timeframe)}</span>
        </div>
      ) : null}
      {loadState === 'iframe' ? (
        <iframe
          className="tradingview-chart__iframe"
          src={embedUrl}
          title={`${tradingViewSymbol} TradingView`}
        />
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
      if (existingScript.dataset.status === 'ready') {
        resolve();
        return;
      }

      if (existingScript.dataset.status === 'error') {
        reject(new Error('TradingView script failed'));
        return;
      }

      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('TradingView script failed')), { once: true });
      return;
    }

    const script = document.createElement('script');

    script.async = true;
    script.id = tradingViewScriptId;
    script.src = 'https://s3.tradingview.com/tv.js';
    script.addEventListener('load', () => {
      script.dataset.status = 'ready';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => {
      script.dataset.status = 'error';
      reject(new Error('TradingView script failed'));
    }, { once: true });
    document.head.appendChild(script);
  });
}

function buildTradingViewEmbedUrl(symbol: string, timeframe: Timeframe, theme: 'dark' | 'light') {
  const params = new URLSearchParams({
    allow_symbol_change: '1',
    calendar: '0',
    hideideas: '1',
    interval: toTradingViewInterval(timeframe),
    locale: 'fr',
    saveimage: '1',
    style: '1',
    symbol,
    theme,
    timezone: 'Etc/UTC',
    withdateranges: '1',
  });

  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
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

  if (marketType !== 'spot' && exchangeId === 'binance') {
    return `${prefix}:${base}${quote}PERP`;
  }

  if (marketType !== 'spot' && ['bybit', 'okx', 'bitget'].includes(exchangeId)) {
    return `${prefix}:${base}${quote}.P`;
  }

  return `${prefix}:${base}${quote}`;
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
