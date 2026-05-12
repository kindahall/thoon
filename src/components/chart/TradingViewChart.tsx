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

const tradingViewEmbedScriptUrl = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export function TradingViewChart({ exchangeId, marketType, symbol, timeframe }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { resolvedTheme } = useTheme();
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

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    setLoadState('loading');
    container.innerHTML = '';

    const widget = document.createElement('div');
    const copyright = document.createElement('div');
    const link = document.createElement('a');
    const linkLabel = document.createElement('span');
    const trademark = document.createElement('span');
    const script = document.createElement('script');

    widget.className = 'tradingview-widget-container__widget';
    copyright.className = 'tradingview-widget-copyright';
    link.href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingViewSymbol)}`;
    link.rel = 'noopener nofollow';
    link.target = '_blank';
    linkLabel.className = 'blue-text';
    linkLabel.textContent = `${tradingViewSymbol} chart`;
    trademark.className = 'trademark';
    trademark.textContent = ' by TradingView';
    link.appendChild(linkLabel);
    copyright.append(link, trademark);
    script.async = true;
    script.src = tradingViewEmbedScriptUrl;
    script.type = 'text/javascript';
    script.textContent = JSON.stringify(widgetOptions);
    script.addEventListener('error', () => {
      if (!cancelled) {
        setLoadState('fallback');
      }
    });

    container.append(widget, copyright, script);

    const readyPoll = window.setInterval(() => {
      if (!cancelled && container.querySelector('iframe')) {
        setLoadState('ready');
        window.clearInterval(readyPoll);
      }
    }, 250);
    const watchdog = window.setTimeout(() => {
      if (!cancelled) {
        setLoadState(container.querySelector('iframe') ? 'ready' : 'fallback');
      }
    }, 12_000);
    const stopPolling = window.setTimeout(() => {
      window.clearInterval(readyPoll);
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(readyPoll);
      window.clearTimeout(watchdog);
      window.clearTimeout(stopPolling);
      container.innerHTML = '';
    };
  }, [tradingViewSymbol, widgetOptions]);

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
      <div className="tradingview-chart__container tradingview-widget-container" ref={containerRef} />
    </div>
  );
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
