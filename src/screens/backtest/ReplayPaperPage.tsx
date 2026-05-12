'use client';

import { AlertTriangle, CheckCircle2, Download, Pause, Play, StepBack, StepForward, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import { patchJson, postJson } from '../../services/api-client';
import type { Candle, MarketPair, Timeframe } from '../../types/market';
import type { BacktestReport, JournalTrade, PaperTestSession } from '../../types/trading';
import { formatUsd } from '../../utils/format';

type ReplayPaperPageProps = {
  candleError?: string;
  initialCandles?: Candle[];
  initialPair?: string;
  initialReport?: BacktestReport;
  initialSession?: PaperTestSession;
  initialStrategyId?: string;
  initialTimeframe?: Timeframe;
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

export function ReplayPaperPage({ candleError, initialCandles = [], initialPair, initialReport, initialSession, initialStrategyId, initialTimeframe, marketPairs }: ReplayPaperPageProps) {
  const basePair = marketPairs.find((pair) => pair.symbol === initialPair) ?? marketPairs[0];
  const firstPair = basePair
    ? {
        ...basePair,
        candles: initialCandles.length ? initialCandles : basePair.candles,
        timeframe: initialTimeframe ?? basePair.timeframe,
      }
    : undefined;
  const replayMarketPairs = firstPair ? [firstPair, ...marketPairs.filter((pair) => pair.symbol !== firstPair.symbol)] : marketPairs;
  const firstCursor = initialReplayCursor(firstPair?.candles.length ?? 0);
  const firstLogCandle = firstPair?.candles[firstCursor] ?? firstPair?.candles[0];
  const startedSessionRef = useRef(false);
  const [symbol, setSymbol] = useState(firstPair?.symbol ?? 'BTC/USDT');
  const [timeRange, setTimeRange] = useState('30D');
  const [startingCapital, setStartingCapital] = useState(10000);
  const [fees, setFees] = useState(0.06);
  const [slippage, setSlippage] = useState(0.02);
  const [cursor, setCursor] = useState(firstCursor);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState('1x');
  const [orderType, setOrderType] = useState<OrderType>('Market');
  const [balance, setBalance] = useState(10000);
  const [position, setPosition] = useState<PaperPosition | null>(null);
  const [status, setStatus] = useState('Paper only');
  const [sessionStatus, setSessionStatus] = useState<PaperTestSession['status']>(initialSession?.status ?? 'prepared');
  const [sessionTradesRecorded, setSessionTradesRecorded] = useState(initialSession?.tradesRecorded ?? 0);
  const [sessionPnl, setSessionPnl] = useState(initialSession?.pnl ?? 0);
  const [logs, setLogs] = useState<PaperTradeLog[]>(() => [
    {
      action: 'replay started',
      details: initialSession ? `Linked to ${initialSession.id}` : 'Future candles hidden',
      id: 'paper-log-start',
      pnl: 0,
      price: firstPair?.lastPrice ?? 0,
      side: '-',
      status: 'system',
      time: formatReplayLogTime(firstLogCandle?.time),
      type: '-',
    },
  ]);

  const pair = replayMarketPairs.find((item) => item.symbol === symbol) ?? firstPair;
  const candles = pair?.candles ?? [];
  const safeCursor = Math.min(Math.max(cursor, 8), Math.max(candles.length - 1, 8));
  const currentCandle = candles[safeCursor] ?? candles[candles.length - 1];
  const currentPrice = currentCandle?.close ?? pair?.lastPrice ?? 0;
  const unrealizedPnl = position ? calculatePnl(position, currentPrice) : 0;
  const equity = balance + unrealizedPnl;
  const visibleCandles = useMemo(() => candles.slice(0, safeCursor + 1), [candles, safeCursor]);
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const nextHiddenCandle = safeCursor < candles.length - 1 ? candles[safeCursor + 1] : undefined;
  const chartTimeframe = pair?.timeframe ?? '15m';
  const progressPct = candles.length > 1 ? Math.round((safeCursor / (candles.length - 1)) * 100) : 0;
  const sessionLinked = Boolean(initialSession && initialReport);
  const sessionTradeGoal = initialReport ? Math.max(initialReport.executionSettings?.marketType === 'perpetual' ? 10 : 6, 10) : 10;

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

  useEffect(() => {
    if (!initialSession || startedSessionRef.current) {
      return;
    }

    startedSessionRef.current = true;

    if (initialSession.status !== 'prepared') {
      return;
    }

    patchJson<PaperTestSession>(`/api/paper-tests/${encodeURIComponent(initialSession.id)}`, {
      note: 'Replay paper test opened by user.',
      status: 'running',
    })
      .then((session) => {
        setSessionStatus(session.status);
        setSessionTradesRecorded(session.tradesRecorded);
        setSessionPnl(session.pnl);
      })
      .catch(() => {
        setStatus('Session update failed');
      });
  }, [initialSession]);

  function changeSymbol(nextSymbol: string) {
    const nextPair = replayMarketPairs.find((item) => item.symbol === nextSymbol);
    const nextCursor = initialReplayCursor(nextPair?.candles.length ?? 0);
    const nextCandle = nextPair?.candles[nextCursor] ?? nextPair?.candles[0];
    setSymbol(nextSymbol);
    setCursor(nextCursor);
    setIsPlaying(false);
    setPosition(null);
    setBalance(startingCapital);
    setStatus('Paper only');
    setLogs([
      {
        action: 'replay restarted',
        details: 'Future candles hidden',
        id: `paper-log-restart-${Date.now()}`,
        pnl: 0,
        price: nextCandle?.close ?? nextPair?.lastPrice ?? 0,
        side: '-',
        status: 'system',
        time: formatReplayLogTime(nextCandle?.time),
        type: '-',
      },
    ]);
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

  async function closePaperTrade() {
    if (!position) {
      return;
    }

    const pnl = calculatePnl(position, currentPrice);
    const rMultiple = calculateRMultiple(pnl, startingCapital, initialReport);
    const closedSide = position.side;
    const closedSize = position.size;
    setBalance((current) => current + pnl);
    setPosition(null);
    setStatus('Position closed');
    pushLog({
      action: 'position closed',
      details: `${closedSize} ${pair?.base ?? 'coin'} at cursor`,
      pnl,
      price: currentPrice,
      side: closedSide,
      status: 'closed',
      type: orderType,
    });

    if (!initialSession) {
      return;
    }

    try {
      await postJson<JournalTrade>('/api/journal', {
        lessons: 'Paper replay trade recorded from linked agent paper-test session.',
        notes: `Paper session ${initialSession.id}; strategy ${initialStrategyId ?? initialSession.strategyId}; report ${initialSession.reportId}; checksum ${initialSession.candleChecksum}.`,
        pnl,
        rMultiple,
        side: closedSide === 'Short' ? 'short' : 'long',
        source: 'paper',
        symbol,
        tag: `paper-test:${initialSession.id}`,
      });
      const nextSession = await patchJson<PaperTestSession>(`/api/paper-tests/${encodeURIComponent(initialSession.id)}`, {
        note: `Recorded ${closedSide.toLowerCase()} paper trade: ${formatUsd(pnl)} (${rMultiple.toFixed(2)}R).`,
        pnlDelta: pnl,
        rMultipleDelta: rMultiple,
        status: 'running',
        tradeDelta: 1,
      });
      setSessionStatus(nextSession.status);
      setSessionTradesRecorded(nextSession.tradesRecorded);
      setSessionPnl(nextSession.pnl);
      setStatus('Paper trade saved');
    } catch {
      setStatus('Paper trade not saved');
      pushLog({
        action: 'journal save failed',
        details: 'Closed trade could not be persisted; retry from History if needed',
        pnl: 0,
        price: currentPrice,
        side: '-',
        status: 'system',
        type: '-',
      });
    }
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
      time: formatReplayLogTime(currentCandle?.time),
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

      <Card className="paper-session-card">
        <div className="paper-session-head">
          <div>
            <h2>{sessionLinked ? 'Agent Paper Validation Session' : initialReport ? 'Untracked Paper Replay' : 'Unlinked Replay'}</h2>
            <span>{initialSession ? `${initialSession.market} ${initialSession.timeframe} · ${initialSession.botScore}/100 · ${initialSession.dataSource}` : initialReport ? 'Report loaded, but no paper-test session is tracking confirmation yet.' : 'This replay is not linked to an agent paper-test recommendation.'}</span>
          </div>
          <Badge tone={sessionLinked ? 'positive' : 'warning'}>{sessionLinked ? sessionStatus : 'manual'}</Badge>
        </div>
        {candleError ? (
          <div className="paper-session-warning">
            <AlertTriangle size={15} />
            <span>{candleError}</span>
          </div>
        ) : null}
        <div className="paper-session-grid">
          <ReplayMeta label="Strategy" value={initialStrategyId ?? initialSession?.strategyId ?? '-'} />
          <ReplayMeta label="Report" value={initialSession?.reportId.slice(0, 18) ?? initialReport?.id.slice(0, 18) ?? '-'} />
          <ReplayMeta label="Checksum" value={initialSession?.candleChecksum.slice(0, 14) ?? initialReport?.dataWindow?.candleChecksum?.slice(0, 14) ?? '-'} />
          <ReplayMeta label="Paper Trades" value={`${sessionTradesRecorded}/${sessionTradeGoal}`} />
          <ReplayMeta label="Paper PnL" value={formatUsd(sessionPnl)} />
        </div>
        <div className="paper-session-steps">
          <span><CheckCircle2 size={14} /> Step/Play the replay with future candles hidden.</span>
          <span><CheckCircle2 size={14} /> Take only trades that match the strategy idea and exact report market/timeframe.</span>
          <span><CheckCircle2 size={14} /> Closed trades are saved to the real journal.</span>
          <span><CheckCircle2 size={14} /> The strategy is not confirmed until recorded paper trades support the backtest.</span>
        </div>
      </Card>

      <div className="replay-layout">
        <Card className="replay-chart-card">
          <div className="replay-toolbar">
            <ReplaySelect label="Market / Pair" onChange={changeSymbol} value={symbol}>
              {replayMarketPairs.map((item) => (
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
              <h2>
                {symbol}
                <small>{chartTimeframe}</small>
              </h2>
              <span>
                {formatReplayDateTime(currentCandle?.time)} · Cursor {safeCursor + 1}/{candles.length} · {formatUsd(currentPrice)}
              </span>
            </div>
            <Badge tone="warning">Future hidden</Badge>
          </div>

          <div className="replay-chart-meta" aria-label="Replay chart context">
            <ReplayMeta label="Timeframe" value={chartTimeframe} />
            <ReplayMeta label="Data Window" value={`${formatReplayDate(firstCandle?.time)} - ${formatReplayDate(lastCandle?.time)}`} />
            <ReplayMeta label="Current Candle" value={formatReplayDateTime(currentCandle?.time)} />
            <ReplayMeta label="Hidden From" value={nextHiddenCandle ? formatReplayDateTime(nextHiddenCandle.time) : 'End reached'} />
            <ReplayMeta label="Progress" value={`${progressPct}% · ${timeRange}`} />
          </div>

          <ReplayChart candles={candles} cursor={safeCursor} timeframe={chartTimeframe} visibleCandles={visibleCandles} />

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
              <span>Date Cursor · {formatReplayDateTime(currentCandle?.time)}</span>
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
            <Button disabled={!position} icon={<XCircle size={15} />} onClick={() => void closePaperTrade()} variant="danger">
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

function ReplayChart({ candles, cursor, timeframe, visibleCandles }: { candles: Candle[]; cursor: number; timeframe: string; visibleCandles: Candle[] }) {
  const width = 900;
  const height = 360;
  const paddingX = 34;
  const topPadding = 28;
  const bottomPadding = 44;
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const plotHeight = height - topPadding - bottomPadding;
  const candleWidth = Math.max(5, (width - paddingX * 2) / Math.max(candles.length, 1) - 4);
  const hiddenX = paddingX + (cursor / Math.max(candles.length - 1, 1)) * (width - paddingX * 2);
  const gridLines = [0.25, 0.5, 0.75].map((ratio) => ({
    price: max - range * ratio,
    y: topPadding + plotHeight * ratio,
  }));
  const firstCandle = candles[0];
  const currentCandle = candles[cursor];
  const lastCandle = candles[candles.length - 1];

  function y(price: number) {
    return height - bottomPadding - ((price - min) / range) * plotHeight;
  }

  return (
    <div className="replay-chart-frame">
      <svg aria-label="Replay chart with hidden future" role="img" viewBox={`0 0 ${width} ${height}`}>
        <g className="replay-grid-lines">
          {gridLines.map((line) => (
            <line key={line.y} x1={paddingX} x2={width - paddingX} y1={line.y} y2={line.y} />
          ))}
        </g>
        <text className="replay-chart-badge" x={paddingX} y={topPadding - 7}>
          {timeframe}
        </text>
        {gridLines.map((line) => (
          <text className="replay-price-label" key={line.price} x={width - paddingX + 8} y={line.y + 4}>
            {formatCompactPrice(line.price)}
          </text>
        ))}
        {visibleCandles.map((candle, index) => {
          const x = paddingX + (index / Math.max(candles.length - 1, 1)) * (width - paddingX * 2);
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
        <line className="replay-cursor-line" x1={hiddenX} x2={hiddenX} y1={topPadding} y2={height - bottomPadding} />
        <rect className="replay-hidden-zone" height={plotHeight} width={Math.max(0, width - hiddenX - paddingX)} x={hiddenX} y={topPadding} />
        <text className="replay-hidden-text" x={hiddenX + 24} y={topPadding + 34}>
          Future hidden
        </text>
        <g className="replay-axis-labels">
          <text x={paddingX} y={height - 12}>{formatReplayAxisDate(firstCandle?.time)}</text>
          <text textAnchor="middle" x={hiddenX} y={height - 12}>{formatReplayAxisDate(currentCandle?.time)}</text>
          <text textAnchor="end" x={width - paddingX} y={height - 12}>{formatReplayAxisDate(lastCandle?.time)}</text>
        </g>
      </svg>
    </div>
  );
}

function ReplayMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
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

function calculateRMultiple(pnl: number, startingCapital: number, report?: BacktestReport) {
  const riskPct = report?.executionSettings?.riskPerTradePct ?? 1;
  const riskAmount = Math.max(1, startingCapital * (riskPct / 100));

  return pnl / riskAmount;
}

function initialReplayCursor(candleCount: number) {
  return Math.min(28, Math.max(candleCount - 10, 8));
}

function formatReplayDateTime(time?: number) {
  if (!time) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: 'short',
  }).format(toDate(time));
}

function formatReplayDate(time?: number) {
  if (!time) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
  }).format(toDate(time));
}

function formatReplayAxisDate(time?: number) {
  if (!time) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: 'short',
  }).format(toDate(time));
}

function formatReplayLogTime(time?: number) {
  return formatReplayDateTime(time);
}

function formatCompactPrice(value: number) {
  if (value >= 1000) {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }

  return `$${value.toFixed(value >= 10 ? 2 : 4)}`;
}

function toDate(time: number) {
  return new Date(time > 1_000_000_000_000 ? time : time * 1000);
}
