'use client';

import { Download, Pause, Play, StepBack, StepForward, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import type { Candle, MarketPair } from '../../types/market';
import { formatUsd } from '../../utils/format';

type ReplayPaperPageProps = {
  initialPair?: string;
  marketPairs: MarketPair[];
};

type OrderType = 'Market' | 'Limit' | 'Stop';
type PositionSide = 'Long' | 'Short';

type PaperPosition = {
  entry: number;
  side: PositionSide;
  size: number;
};

type PaperTradeLog = {
  action: string;
  details: string;
  id: string;
  pnl: number;
  price: number;
  side: PositionSide | '-';
  status: 'open' | 'closed' | 'system';
  time: string;
  type: OrderType | '-';
};

const speeds = ['1x', '2x', '4x'];
const timeRanges = ['30D', '90D', '180D'];

export function ReplayPaperPage({ initialPair, marketPairs }: ReplayPaperPageProps) {
  const firstPair = marketPairs.find((pair) => pair.symbol === initialPair) ?? marketPairs[0];
  const [symbol, setSymbol] = useState(firstPair?.symbol ?? 'BTC/USDT');
  const [timeRange, setTimeRange] = useState('30D');
  const [startingCapital, setStartingCapital] = useState(10000);
  const [fees, setFees] = useState(0.06);
  const [slippage, setSlippage] = useState(0.02);
  const [cursor, setCursor] = useState(28);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState('1x');
  const [orderType, setOrderType] = useState<OrderType>('Market');
  const [balance, setBalance] = useState(10000);
  const [position, setPosition] = useState<PaperPosition | null>(null);
  const [status, setStatus] = useState('Paper only');
  const [logs, setLogs] = useState<PaperTradeLog[]>(() => [
    {
      action: 'replay started',
      details: 'Future candles hidden',
      id: 'paper-log-start',
      pnl: 0,
      price: firstPair?.lastPrice ?? 0,
      side: '-',
      status: 'system',
      time: '09:15',
      type: '-',
    },
  ]);

  const pair = marketPairs.find((item) => item.symbol === symbol) ?? firstPair;
  const candles = pair?.candles ?? [];
  const safeCursor = Math.min(Math.max(cursor, 8), Math.max(candles.length - 1, 8));
  const currentCandle = candles[safeCursor] ?? candles[candles.length - 1];
  const currentPrice = currentCandle?.close ?? pair?.lastPrice ?? 0;
  const unrealizedPnl = position ? calculatePnl(position, currentPrice) : 0;
  const equity = balance + unrealizedPnl;
  const visibleCandles = useMemo(() => candles.slice(0, safeCursor + 1), [candles, safeCursor]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const intervalMs = speed === '4x' ? 250 : speed === '2x' ? 450 : 800;
    const interval = window.setInterval(() => {
      setCursor((current) => {
        if (current >= candles.length - 2) {
          setIsPlaying(false);
          return current;
        }

        return current + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [candles.length, isPlaying, speed]);

  function changeSymbol(nextSymbol: string) {
    const nextPair = marketPairs.find((item) => item.symbol === nextSymbol);
    setSymbol(nextSymbol);
    setCursor(Math.min(28, Math.max((nextPair?.candles.length ?? 30) - 10, 8)));
    setIsPlaying(false);
    setPosition(null);
    setBalance(startingCapital);
    setStatus('Paper only');
  }

  function updateStartingCapital(nextCapital: number) {
    setStartingCapital(nextCapital);
    setBalance(nextCapital);
  }

  function step(direction: -1 | 1) {
    setCursor((current) => Math.min(Math.max(current + direction, 8), Math.max(candles.length - 2, 8)));
  }

  function openPaperTrade(side: PositionSide) {
    if (position) {
      return;
    }

    const size = Number(((balance * 0.2) / currentPrice).toFixed(4));
    const nextPosition = { entry: currentPrice, side, size };
    setPosition(nextPosition);
    setStatus(`${side} opened`);
    pushLog({
      action: `${side.toLowerCase()} opened`,
      details: `${orderType} paper order`,
      pnl: 0,
      price: currentPrice,
      side,
      status: 'open',
      type: orderType,
    });
  }

  function closePaperTrade() {
    if (!position) {
      return;
    }

    const pnl = calculatePnl(position, currentPrice);
    setBalance((current) => current + pnl);
    setPosition(null);
    setStatus('Position closed');
    pushLog({
      action: 'position closed',
      details: `${position.size} ${pair?.base ?? 'coin'} at cursor`,
      pnl,
      price: currentPrice,
      side: position.side,
      status: 'closed',
      type: orderType,
    });
  }

  function exportLog() {
    setStatus('Export ready');
    pushLog({
      action: 'export prepared',
      details: 'Local paper log',
      pnl: 0,
      price: currentPrice,
      side: '-',
      status: 'system',
      type: '-',
    });
  }

  function pushLog(entry: Omit<PaperTradeLog, 'id' | 'time'>) {
    const nextLog: PaperTradeLog = {
      ...entry,
      id: `paper-log-${Date.now()}`,
      time: `09:${String(15 + logs.length * 3).padStart(2, '0')}`,
    };
    setLogs((current) => [nextLog, ...current].slice(0, 8));
  }

  return (
    <section className="replay-page" aria-label="Replay paper testing">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Replay</p>
          <h1>Paper Testing</h1>
        </div>
        <div className="workspace-header__right">
          <Badge tone="positive">No live orders</Badge>
          <Button icon={<Download size={15} />} onClick={exportLog} size="sm" variant="ghost">
            Export
          </Button>
          <HelpPopover items={['Replay trades are local paper events.', 'The hidden area masks future candles.']} title="Replay" />
        </div>
      </div>

      <div className="replay-layout">
        <Card className="replay-chart-card">
          <div className="replay-toolbar">
            <ReplaySelect label="Market / Pair" onChange={changeSymbol} value={symbol}>
              {marketPairs.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol}
                </option>
              ))}
            </ReplaySelect>
            <ReplaySelect label="Time Range" onChange={setTimeRange} value={timeRange}>
              {timeRanges.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </ReplaySelect>
            <ReplayNumberField label="Starting Capital" onChange={updateStartingCapital} suffix="USDT" value={startingCapital} />
            <ReplayNumberField label="Fees" onChange={setFees} suffix="%" value={fees} />
            <ReplayNumberField label="Slippage" onChange={setSlippage} suffix="%" value={slippage} />
          </div>

          <div className="replay-chart-head">
            <div>
              <h2>{symbol}</h2>
              <span>
                Cursor {safeCursor} · {formatUsd(currentPrice)}
              </span>
            </div>
            <Badge tone="warning">Future hidden</Badge>
          </div>

          <ReplayChart candles={candles} cursor={safeCursor} visibleCandles={visibleCandles} />

          <div className="replay-controls">
            <Button icon={<StepBack size={15} />} onClick={() => step(-1)} size="sm" variant="ghost">
              Step Back
            </Button>
            <Button icon={isPlaying ? <Pause size={15} /> : <Play size={15} />} onClick={() => setIsPlaying((current) => !current)} size="sm" variant="primary">
              {isPlaying ? 'Pause' : 'Play'}
            </Button>
            <Button icon={<StepForward size={15} />} onClick={() => step(1)} size="sm" variant="ghost">
              Step Forward
            </Button>
            <label className="replay-speed">
              <span>Speed</span>
              <select onChange={(event) => setSpeed(event.target.value)} value={speed}>
                {speeds.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="replay-cursor">
              <span>Date Cursor</span>
              <input max={Math.max(candles.length - 2, 8)} min={8} onChange={(event) => setCursor(Number(event.target.value))} type="range" value={safeCursor} />
            </label>
          </div>
        </Card>

        <Card className="paper-panel-card">
          <div className="paper-panel-head">
            <div>
              <h2>Paper Trade</h2>
              <span>{status}</span>
            </div>
            {position ? <Badge tone={position.side === 'Long' ? 'positive' : 'negative'}>{position.side}</Badge> : <Badge>Flat</Badge>}
          </div>

          <div className="paper-metrics">
            <PaperMetric label="Balance" value={formatUsd(balance)} />
            <PaperMetric label="Equity" tone={equity >= startingCapital ? 'positive' : 'negative'} value={formatUsd(equity)} />
            <PaperMetric label="Unrealized PnL" tone={unrealizedPnl >= 0 ? 'positive' : 'negative'} value={formatUsd(unrealizedPnl)} />
          </div>

          <div className="order-type-switch" aria-label="Order type">
            {(['Market', 'Limit', 'Stop'] satisfies OrderType[]).map((item) => (
              <button className={orderType === item ? 'is-active' : undefined} key={item} onClick={() => setOrderType(item)} type="button">
                {item}
              </button>
            ))}
          </div>

          <div className="paper-actions">
            <Button disabled={Boolean(position)} onClick={() => openPaperTrade('Long')} variant="primary">
              Buy
            </Button>
            <Button disabled={Boolean(position)} onClick={() => openPaperTrade('Short')} variant="secondary">
              Sell
            </Button>
            <Button disabled={!position} icon={<XCircle size={15} />} onClick={closePaperTrade} variant="danger">
              Close
            </Button>
          </div>

          <div className="paper-position-box">
            <PaperLine label="Entry" value={position ? formatUsd(position.entry) : '-'} />
            <PaperLine label="Size" value={position ? `${position.size} ${pair?.base ?? ''}` : '-'} />
            <PaperLine label="Fees + Slip" value={`${(fees + slippage).toFixed(2)}%`} />
          </div>
        </Card>
      </div>

      <Card className="paper-log-card">
        <div className="paper-log-head">
          <h2>Paper Trade Log</h2>
          <span>{logs.length} events</span>
        </div>
        <div className="paper-log-table" role="table" aria-label="Paper trade log">
          <div className="paper-log-table__head" role="row">
            <span>Time</span>
            <span>Action</span>
            <span>Side</span>
            <span>Type</span>
            <span>Price</span>
            <span>PnL</span>
            <span>Status</span>
            <span>Details</span>
          </div>
          {logs.map((log) => (
            <div className="paper-log-row" key={log.id} role="row">
              <span>{log.time}</span>
              <strong>{log.action}</strong>
              <span>{log.side}</span>
              <span>{log.type}</span>
              <span>{log.price ? formatUsd(log.price) : '-'}</span>
              <span className={log.pnl >= 0 ? 'positive' : 'negative'}>{log.pnl ? formatUsd(log.pnl) : '-'}</span>
              <Badge tone={log.status === 'closed' ? 'positive' : log.status === 'open' ? 'warning' : 'neutral'}>{log.status}</Badge>
              <span>{log.details}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

function ReplayChart({ candles, cursor, visibleCandles }: { candles: Candle[]; cursor: number; visibleCandles: Candle[] }) {
  const width = 900;
  const height = 360;
  const padding = 28;
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const candleWidth = Math.max(5, (width - padding * 2) / Math.max(candles.length, 1) - 4);
  const hiddenX = padding + (cursor / Math.max(candles.length - 1, 1)) * (width - padding * 2);

  function y(price: number) {
    return height - padding - ((price - min) / range) * (height - padding * 2);
  }

  return (
    <div className="replay-chart-frame">
      <svg aria-label="Replay chart with hidden future" role="img" viewBox={`0 0 ${width} ${height}`}>
        <g className="replay-grid-lines">
          <line x1={padding} x2={width - padding} y1="90" y2="90" />
          <line x1={padding} x2={width - padding} y1="180" y2="180" />
          <line x1={padding} x2={width - padding} y1="270" y2="270" />
        </g>
        {visibleCandles.map((candle, index) => {
          const x = padding + (index / Math.max(candles.length - 1, 1)) * (width - padding * 2);
          const openY = y(candle.open);
          const closeY = y(candle.close);
          const highY = y(candle.high);
          const lowY = y(candle.low);
          const isUp = candle.close >= candle.open;

          return (
            <g className={isUp ? 'is-up' : 'is-down'} key={`${candle.time}-${index}`}>
              <line x1={x} x2={x} y1={highY} y2={lowY} />
              <rect height={Math.max(3, Math.abs(closeY - openY))} rx="2" width={candleWidth} x={x - candleWidth / 2} y={Math.min(openY, closeY)} />
            </g>
          );
        })}
        <line className="replay-cursor-line" x1={hiddenX} x2={hiddenX} y1={padding} y2={height - padding} />
        <rect className="replay-hidden-zone" height={height - padding * 2} width={width - hiddenX - padding} x={hiddenX} y={padding} />
        <text className="replay-hidden-text" x={hiddenX + 24} y={padding + 34}>
          Future hidden
        </text>
      </svg>
    </div>
  );
}

function ReplaySelect({ children, label, onChange, value }: { children: ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="replay-field">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {children}
      </select>
    </label>
  );
}

function ReplayNumberField({ label, onChange, suffix, value }: { label: string; onChange: (value: number) => void; suffix: string; value: number }) {
  return (
    <label className="replay-number-field">
      <span>{label}</span>
      <div>
        <input onChange={(event) => onChange(Number(event.target.value))} step="0.01" type="number" value={value} />
        <small>{suffix}</small>
      </div>
    </label>
  );
}

function PaperMetric({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'positive' | 'negative'; value: string }) {
  return (
    <div className="paper-metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function PaperLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="paper-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function calculatePnl(position: PaperPosition, currentPrice: number) {
  const direction = position.side === 'Long' ? 1 : -1;

  return (currentPrice - position.entry) * position.size * direction;
}
