'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTheme } from '../../hooks/useTheme';
import type { Timeframe } from '../../types/market';

type TradingViewChartProps = {
  exchangeId: string;
  marketType: 'spot' | 'perpetual' | 'futures';
  symbol: string;
  timeframe: Timeframe;
};

export function TradingViewChart({ exchangeId, marketType, symbol, timeframe }: TradingViewChartProps) {
  const { resolvedTheme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loadState, setLoadState] = useState<'fallback' | 'loading' | 'ready'>('loading');
  const tradingViewSymbol = useMemo(() => toTradingViewSymbol(symbol, exchangeId, marketType), [exchangeId, marketType, symbol]);
  const widgetOptions = useMemo(
    () => ({
      allow_symbol_change: true,
      autosize: true,
      backgroundColor: resolvedTheme === 'light' ? '#f7fbff' : '#06111f',
      calendar: false,
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
    }),
    [resolvedTheme, timeframe, tradingViewSymbol],
  );
  const frameSrc = useMemo(() => tradingViewFrameSrc(widgetOptions), [widgetOptions]);

  useEffect(() => {
    let cancelled = false;

    setLoadState('loading');

    const frameReadyFallback = window.setTimeout(() => {
      if (!cancelled && iframeRef.current) {
        setLoadState('ready');
      }
    }, 4_500);

    const watchdog = window.setTimeout(() => {
      if (!cancelled) {
        setLoadState((currentState) => (currentState === 'loading' ? 'fallback' : currentState));
      }
    }, 22_000);

    return () => {
      cancelled = true;
      window.clearTimeout(frameReadyFallback);
      window.clearTimeout(watchdog);
    };
  }, [frameSrc]);

  return (
    <div className={`tradingview-chart tradingview-chart--${loadState}`} aria-label={`${symbol} TradingView chart`}>
      {loadState === 'loading' ? (
        <div className={`tradingview-chart__state tradingview-chart__state--${loadState}`}>
          <strong>TradingView charge le chart</strong>
          <span>{tradingViewSymbol} · {timeframeLabel(timeframe)}</span>
        </div>
      ) : null}
      {loadState === 'fallback' ? (
        <div className="tradingview-chart__state tradingview-chart__state--fallback">
          <strong>TradingView indisponible</strong>
          <span>{tradingViewSymbol} · {timeframeLabel(timeframe)}</span>
          <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingViewSymbol)}`} rel="noopener noreferrer" target="_blank">
            Ouvrir TradingView
          </a>
        </div>
      ) : null}
      <div className="tradingview-chart__container tradingview-widget-container">
        <iframe
          allow="fullscreen"
          className="tradingview-chart__iframe"
          key={frameSrc}
          onError={() => setLoadState('fallback')}
          onLoad={() => setLoadState('ready')}
          ref={iframeRef}
          referrerPolicy="origin"
          scrolling="no"
          src={frameSrc}
          title={`${tradingViewSymbol} chart by TradingView`}
        />
        <div className="tradingview-widget-copyright">
          <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingViewSymbol)}`} rel="noopener nofollow" target="_blank">
            <span className="blue-text">{tradingViewSymbol} chart</span>
          </a>
          <span className="trademark"> by TradingView</span>
        </div>
      </div>
    </div>
  );
}

function tradingViewFrameSrc(options: Record<string, unknown>) {
  const widgetOptions = {
    ...options,
    height: '100%',
    utm_campaign: 'advanced-chart',
    utm_medium: 'widget_new',
    utm_source: 'localhost',
    width: '100%',
  };

  return `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=fr#${encodeURIComponent(JSON.stringify(widgetOptions))}`;
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

  if (marketType !== 'spot' && ['binance', 'bybit', 'okx', 'bitget'].includes(exchangeId)) {
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
