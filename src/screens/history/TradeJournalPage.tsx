'use client';

import { CalendarDays, ChartCandlestick, Copy, Edit3, ExternalLink, Filter, MoreVertical, NotebookText, Trash2, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Button, Card, EmptyState, HelpPopover, Modal } from '../../components/ui';
import { deleteJson, postJson } from '../../services/api-client';
import type { AgentReport, AgentRun, AgentSettings, AgentSuggestion, JournalTrade, StrategyVersion } from '../../types/trading';
import { cn } from '../../utils/classNames';
import { formatUsd } from '../../utils/format';

type TradeJournalPageProps = {
  agentReports: AgentReport[];
  agentRuns: AgentRun[];
  agentSettings: AgentSettings;
  agentSuggestions: AgentSuggestion[];
  agentVersions: StrategyVersion[];
  initialPair?: string;
  trades: JournalTrade[];
};

type TradeTab = 'all' | JournalTrade['source'];
type DateRange = '7d' | '30d' | '90d' | 'all';
type ResultFilter = 'all' | 'win' | 'loss';
type SourceFilter = 'all' | JournalTrade['source'];

type JournalSummary = {
  avgR: number;
  bestTrade?: JournalTrade;
  expectancy: number;
  totalPnl: number;
  winRate: number;
  worstTrade?: JournalTrade;
};

type BestSetup = {
  avgR: number;
  name: string;
  totalPnl: number;
  trades: number;
  winRate: number;
};

const tradeTabs: Array<{ label: string; value: TradeTab }> = [
  { label: 'All Trades', value: 'all' },
  { label: 'Manual', value: 'manual' },
  { label: 'Bot', value: 'bot' },
  { label: 'Paper', value: 'paper' },
];

const dateRanges: Array<{ label: string; value: DateRange }> = [
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: 'All', value: 'all' },
];
const pageSize = 5;

export function TradeJournalPage({ agentReports, agentRuns, agentSettings, agentSuggestions, agentVersions, initialPair, trades }: TradeJournalPageProps) {
  const [journalTrades, setJournalTrades] = useState(trades);
  const orderedTrades = useMemo(() => [...journalTrades].sort(sortByClosedAt), [journalTrades]);
  const [activeTab, setActiveTab] = useState<TradeTab>('all');
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const pairs = useMemo(() => Array.from(new Set(orderedTrades.map((trade) => trade.symbol))), [orderedTrades]);
  const [pair, setPair] = useState(initialPair && pairs.includes(initialPair) ? initialPair : 'all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [result, setResult] = useState<ResultFilter>('all');
  const [page, setPage] = useState(1);
  const [selectedTradeId, setSelectedTradeId] = useState(orderedTrades[0]?.id ?? '');
  const [actionStatus, setActionStatus] = useState('Ready');
  const [deleteCandidate, setDeleteCandidate] = useState<JournalTrade | null>(null);

  const sourceOptions = useMemo(() => Array.from(new Set(orderedTrades.map((trade) => trade.source))), [orderedTrades]);

  const filteredTrades = useMemo(
    () =>
      orderedTrades.filter((trade) => {
        const matchesTab = activeTab === 'all' || trade.source === activeTab;
        const matchesDate = isInsideRange(trade, dateRange, orderedTrades);
        const matchesPair = pair === 'all' || trade.symbol === pair;
        const matchesSource = source === 'all' || trade.source === source;
        const matchesResult = result === 'all' || (result === 'win' ? trade.pnl > 0 : trade.pnl < 0);

        return matchesTab && matchesDate && matchesPair && matchesSource && matchesResult;
      }),
    [activeTab, dateRange, orderedTrades, pair, result, source],
  );

  const selectedTrade = filteredTrades.find((trade) => trade.id === selectedTradeId) ?? filteredTrades[0] ?? orderedTrades[0];
  const summary = useMemo(() => buildSummary(filteredTrades), [filteredTrades]);
  const bestSetup = useMemo(() => buildBestSetup(filteredTrades), [filteredTrades]);
  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedTrades = filteredTrades.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [activeTab, dateRange, pair, result, source]);

  async function runAction(label: string) {
    if (!selectedTrade) {
      return;
    }

    if (label === 'Delete') {
      setDeleteCandidate(selectedTrade);
      setActionStatus('Delete confirmation required');
      return;
    }

    if (label === 'Duplicate') {
      setActionStatus('Duplicating');

      try {
        const trade = await postJson<JournalTrade>('/api/journal', {
          lessons: selectedTrade.lessons,
          notes: selectedTrade.notes,
          pnl: selectedTrade.pnl,
          rMultiple: selectedTrade.rMultiple,
          side: selectedTrade.side,
          source: selectedTrade.source,
          symbol: selectedTrade.symbol,
          tag: `${selectedTrade.tag}-copy`,
        });

        setJournalTrades((currentTrades) => [trade, ...currentTrades]);
        setSelectedTradeId(trade.id);
        setActionStatus('Duplicated');
      } catch (error) {
        setActionStatus(error instanceof Error ? error.message : 'Duplicate failed');
      }

      return;
    }

    setActionStatus(`${label} ready`);
  }

  async function confirmDeleteTrade() {
    if (!deleteCandidate) {
      return;
    }

    setActionStatus('Deleting');

    try {
      await deleteJson(`/api/journal/${encodeURIComponent(deleteCandidate.id)}`);
      setJournalTrades((currentTrades) => currentTrades.filter((trade) => trade.id !== deleteCandidate.id));
      setSelectedTradeId('');
      setDeleteCandidate(null);
      setActionStatus('Deleted');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Delete failed');
    }
  }

  if (orderedTrades.length === 0) {
    return (
      <section className="trade-journal-page" aria-label="Trade journal">
        <div className="workspace-header workspace-header--compact">
          <div>
            <h1>Trade Journal</h1>
            <p>Review and analyze your trades to improve performance.</p>
          </div>
          <div className="workspace-header__right">
            <StrategyAgentDrawer context="journal" reports={agentReports} runs={agentRuns} settings={agentSettings} suggestions={agentSuggestions} versions={agentVersions} strategyName="Journal research" />
            <HelpPopover items={['Screenshots stay in the detail panel.', 'Real execution remains gated by risk checks.']} title="Trade Journal" />
          </div>
        </div>
        <EmptyState
          actionHref="/charts"
          actionLabel="Open Chart"
          description="Closed manual, bot and paper trades will appear here."
          icon={<NotebookText size={20} />}
          secondaryActionHref="/backtest/replay"
          secondaryActionLabel="Paper Test"
          title="No trades yet"
        />
      </section>
    );
  }

  return (
    <section className="trade-journal-page" aria-label="Trade journal">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Trade Journal</h1>
          <p>Review and analyze your trades to improve performance.</p>
        </div>
        <div className="workspace-header__right">
          <Badge tone="primary">{filteredTrades.length} trades</Badge>
          <StrategyAgentDrawer context="journal" reports={agentReports} runs={agentRuns} settings={agentSettings} suggestions={agentSuggestions} versions={agentVersions} strategyName="Journal research" />
          <Button icon={<Filter size={15} />} onClick={() => setActionStatus('Filters applied')} size="sm" variant="ghost">
            Filters
          </Button>
          <HelpPopover items={['Screenshots stay in the detail panel.', 'Real execution remains gated by risk checks.']} title="Trade Journal" />
        </div>
      </div>

      <div className="journal-market-strip" aria-label="Tracked pairs">
        {pairs.slice(0, 5).map((symbol, index) => (
          <button className={pair === symbol ? 'is-active' : undefined} key={symbol} onClick={() => setPair((current) => (current === symbol ? 'all' : symbol))} type="button">
            <span>{coinBadge(symbol, index)}</span>
            <strong>{symbol}</strong>
            <small className={index % 3 === 1 ? 'negative' : 'positive'}>{index % 3 === 1 ? '-0.23%' : '+0.19%'}</small>
          </button>
        ))}
      </div>

      <div className="journal-grid">
        <div className="journal-main-stack">
          <Card className="journal-table-card">
            <div className="journal-toolbar">
              <div className="journal-tabs" aria-label="Trade source tabs">
                {tradeTabs.map((tab) => (
                  <button className={activeTab === tab.value ? 'is-active' : undefined} key={tab.value} onClick={() => setActiveTab(tab.value)} type="button">
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="journal-filters" aria-label="Journal filters">
                <label>
                  <CalendarDays size={15} />
                  <select aria-label="Date range" value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}>
                    {dateRanges.map((range) => (
                      <option key={range.value} value={range.value}>
                        {range.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <ChartCandlestick size={15} />
                  <select aria-label="Pair" value={pair} onChange={(event) => setPair(event.target.value)}>
                    <option value="all">All Pairs</option>
                    {pairs.map((symbol) => (
                      <option key={symbol} value={symbol}>
                        {symbol}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <NotebookText size={15} />
                  <select aria-label="Source" value={source} onChange={(event) => setSource(event.target.value as SourceFilter)}>
                    <option value="all">All Sources</option>
                    {sourceOptions.map((item) => (
                      <option key={item} value={item}>
                        {titleCase(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <Filter size={15} />
                  <select aria-label="Result" value={result} onChange={(event) => setResult(event.target.value as ResultFilter)}>
                    <option value="all">All Results</option>
                    <option value="win">Win</option>
                    <option value="loss">Loss</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="journal-table" role="table" aria-label="Closed trades">
              <div className="journal-table__head" role="row">
                <span>Date &amp; Time</span>
                <span>Pair</span>
                <span>Side</span>
                <span>Source</span>
                <span>Result</span>
                <span>R/R</span>
                <span>PnL</span>
                <span>Tag</span>
                <span aria-label="Actions" />
              </div>

              {paginatedTrades.map((trade) => (
                <button className={cn('journal-row', selectedTrade?.id === trade.id && 'is-selected')} key={trade.id} onClick={() => setSelectedTradeId(trade.id)} type="button">
                  <span>{formatDateTime(trade.closedAt)}</span>
                  <strong>{trade.symbol}</strong>
                  <span className={trade.side === 'long' ? 'positive' : 'negative'}>{titleCase(trade.side)}</span>
                  <span>{titleCase(trade.source)}</span>
                  <span className={trade.pnl >= 0 ? 'positive' : 'negative'}>{trade.pnl >= 0 ? 'Win' : 'Loss'}</span>
                  <span>{formatR(trade.rMultiple)}</span>
                  <span className={trade.pnl >= 0 ? 'positive' : 'negative'}>{formatUsd(trade.pnl)}</span>
                  <span>
                    <Badge tone="neutral">{trade.tag}</Badge>
                  </span>
                  <MoreVertical size={15} />
                </button>
              ))}
            </div>

            <div className="journal-table-footer">
              <span>
                Showing {paginatedTrades.length} of {filteredTrades.length}
              </span>
              <div>
                <button className={currentPage === 1 ? 'is-active' : undefined} onClick={() => setPage(1)} type="button">1</button>
                <button className={currentPage === 2 ? 'is-active' : undefined} disabled={totalPages < 2} onClick={() => setPage(2)} type="button">2</button>
                <button disabled={totalPages < 3} onClick={() => setPage(totalPages)} type="button">...</button>
              </div>
            </div>
          </Card>

          <Card className="journal-lessons-card">
            <div className="journal-card-head">
              <h2>Mistakes &amp; Lessons</h2>
              <Badge tone="primary">Current set</Badge>
            </div>
            <div className="journal-lessons-grid">
              <div>
                <strong>Common Mistakes</strong>
                <ul>
                  {filteredTrades.filter((trade) => trade.pnl < 0).slice(0, 3).map((trade) => (
                    <li key={trade.id}>{trade.lessons}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Key Lessons</strong>
                <ul>
                  {filteredTrades.filter((trade) => trade.pnl > 0).slice(0, 3).map((trade) => (
                    <li key={trade.id}>{trade.lessons}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        </div>

        <aside className="journal-side-stack" aria-label="Trade journal side panels">
          <PerformanceSummary summary={summary} />
          <BestSetupCard setup={bestSetup} />
          {selectedTrade ? (
            <TradeDetailCard actionStatus={actionStatus} onAction={(label) => void runAction(label)} trade={selectedTrade} />
          ) : (
            <Card className="journal-detail-card">
              <h2>Trade Details</h2>
              <p>No trade selected.</p>
            </Card>
          )}
        </aside>
      </div>

      <Modal onClose={() => setDeleteCandidate(null)} open={deleteCandidate !== null} title="Delete Journal Trade">
        <div className="confirmation-modal-body">
          <p>
            Delete {deleteCandidate?.symbol} {deleteCandidate?.side} trade from the journal. PnL: {deleteCandidate ? formatUsd(deleteCandidate.pnl) : '-'}.
          </p>
          <div>
            <Button onClick={() => setDeleteCandidate(null)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button onClick={confirmDeleteTrade} size="sm" variant="danger">
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function PerformanceSummary({ summary }: { summary: JournalSummary }) {
  const items = [
    { label: 'Win Rate', tone: 'positive', value: `${summary.winRate.toFixed(1)}%` },
    { label: 'Avg R Multiple', value: formatR(summary.avgR) },
    { label: 'Total PnL', tone: summary.totalPnl >= 0 ? 'positive' : 'negative', value: formatUsd(summary.totalPnl) },
    { label: 'Best Trade', tone: 'positive', value: summary.bestTrade ? formatR(summary.bestTrade.rMultiple) : '0.00R' },
    { label: 'Worst Trade', tone: 'negative', value: summary.worstTrade ? formatR(summary.worstTrade.rMultiple) : '0.00R' },
    { label: 'Expectancy', value: formatR(summary.expectancy) },
  ];

  return (
    <Card className="journal-summary-card">
      <div className="journal-card-head">
        <h2>Performance Summary</h2>
        <select aria-label="Summary period" defaultValue="period">
          <option value="period">This Period</option>
        </select>
      </div>
      <div className="journal-summary-grid">
        {items.map((item) => (
          <div className="journal-summary-metric" key={item.label}>
            <span>{item.label}</span>
            <strong className={item.tone}>{item.value}</strong>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BestSetupCard({ setup }: { setup?: BestSetup }) {
  return (
    <Card className="journal-best-setup-card">
      <div className="journal-card-head">
        <h2>Best Setup</h2>
      </div>
      {setup ? (
        <div className="journal-best-setup">
          <Trophy size={22} />
          <div>
            <strong>{setup.name}</strong>
            <span>{setup.trades} trades</span>
          </div>
          <dl>
            <div>
              <dt>Win Rate</dt>
              <dd>{setup.winRate.toFixed(1)}%</dd>
            </div>
            <div>
              <dt>Total PnL</dt>
              <dd className={setup.totalPnl >= 0 ? 'positive' : 'negative'}>{formatUsd(setup.totalPnl)}</dd>
            </div>
            <div>
              <dt>Avg R</dt>
              <dd>{formatR(setup.avgR)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p>No setup in this filter.</p>
      )}
    </Card>
  );
}

type TradeDetailCardProps = {
  actionStatus: string;
  onAction: (label: string) => void;
  trade: JournalTrade;
};

function TradeDetailCard({ actionStatus, onAction, trade }: TradeDetailCardProps) {
  return (
    <Card className="journal-detail-card">
      <div className="journal-card-head">
        <h2>Trade Details</h2>
        <Link href={`/charts?pair=${encodeURIComponent(trade.symbol)}&source=journal&tradeId=${encodeURIComponent(trade.id)}`}>
          Open Chart Screenshot
          <ExternalLink size={14} />
        </Link>
      </div>

      <div className="journal-detail-grid">
        <div className="journal-detail-list">
          <DetailRow label="Date" value={formatDateTime(trade.closedAt)} />
          <DetailRow label="Pair" value={trade.symbol} />
          <DetailRow label="Side" tone={trade.side === 'long' ? 'positive' : 'negative'} value={titleCase(trade.side)} />
          <DetailRow label="Source" value={titleCase(trade.source)} />
          <DetailRow label="R / R" value={formatR(trade.rMultiple)} />
          <DetailRow label="PnL" tone={trade.pnl >= 0 ? 'positive' : 'negative'} value={formatUsd(trade.pnl)} />
          <DetailRow label="Tag" value={trade.tag} />
        </div>

        <div className="journal-notes-panel">
          <strong>Notes</strong>
          <p>{trade.notes}</p>
          <strong>Screenshot</strong>
          <Link className="journal-screenshot-link" href={`/charts?pair=${encodeURIComponent(trade.symbol)}&source=journal&tradeId=${encodeURIComponent(trade.id)}`}>
            <ScreenshotPreview trade={trade} />
          </Link>
        </div>
      </div>

      <div className="journal-lesson-panel">
        <strong>Lesson</strong>
        <p>{trade.lessons}</p>
      </div>

      <div className="journal-detail-actions">
        <Button icon={<Edit3 size={15} />} onClick={() => onAction('Edit')} size="sm" variant="ghost">
          Edit
        </Button>
        <Button icon={<Copy size={15} />} onClick={() => onAction('Duplicate')} size="sm" variant="ghost">
          Duplicate
        </Button>
        <Button icon={<Trash2 size={15} />} onClick={() => onAction('Delete')} size="sm" variant="ghost">
          Delete
        </Button>
        <span>{actionStatus}</span>
      </div>
    </Card>
  );
}

function DetailRow({ label, tone, value }: { label: string; tone?: 'positive' | 'negative'; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function ScreenshotPreview({ trade }: { trade: JournalTrade }) {
  const heights = trade.pnl >= 0 ? [28, 36, 42, 38, 52, 58, 61, 66, 72, 70, 76, 82] : [78, 74, 68, 70, 61, 58, 54, 47, 43, 46, 38, 31];

  return (
    <div className="journal-screenshot-preview" aria-label={`${trade.symbol} chart screenshot preview`}>
      <div className="journal-screenshot-grid" />
      <div className="journal-screenshot-candles">
        {heights.map((height, index) => (
          <span className={(index + (trade.side === 'long' ? 0 : 1)) % 3 === 0 ? 'negative' : 'positive'} key={`${trade.id}-${height}-${index}`} style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}

function buildSummary(trades: JournalTrade[]): JournalSummary {
  if (trades.length === 0) {
    return {
      avgR: 0,
      expectancy: 0,
      totalPnl: 0,
      winRate: 0,
    };
  }

  const winners = trades.filter((trade) => trade.pnl > 0);
  const losers = trades.filter((trade) => trade.pnl < 0);
  const avgR = average(trades.map((trade) => trade.rMultiple));
  const avgWin = average(winners.map((trade) => trade.rMultiple));
  const avgLoss = Math.abs(average(losers.map((trade) => trade.rMultiple)));
  const winRateRaw = winners.length / trades.length;

  return {
    avgR,
    bestTrade: trades.reduce((best, trade) => (trade.pnl > best.pnl ? trade : best), trades[0]),
    expectancy: winRateRaw * avgWin - (1 - winRateRaw) * avgLoss,
    totalPnl: trades.reduce((sum, trade) => sum + trade.pnl, 0),
    winRate: winRateRaw * 100,
    worstTrade: trades.reduce((worst, trade) => (trade.pnl < worst.pnl ? trade : worst), trades[0]),
  };
}

function buildBestSetup(trades: JournalTrade[]): BestSetup | undefined {
  const grouped = new Map<string, JournalTrade[]>();

  for (const trade of trades) {
    grouped.set(trade.tag, [...(grouped.get(trade.tag) ?? []), trade]);
  }

  const setups = Array.from(grouped.entries()).map(([name, setupTrades]) => {
    const winners = setupTrades.filter((trade) => trade.pnl > 0);
    const totalPnl = setupTrades.reduce((sum, trade) => sum + trade.pnl, 0);

    return {
      avgR: average(setupTrades.map((trade) => trade.rMultiple)),
      name,
      totalPnl,
      trades: setupTrades.length,
      winRate: (winners.length / setupTrades.length) * 100,
    };
  });

  return setups.sort((first, second) => second.totalPnl - first.totalPnl || second.avgR - first.avgR)[0];
}

function isInsideRange(trade: JournalTrade, range: DateRange, trades: JournalTrade[]) {
  if (range === 'all') {
    return true;
  }

  const newestTime = Math.max(...trades.map((item) => new Date(item.closedAt).getTime()));
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const cutoff = newestTime - days * 24 * 60 * 60 * 1000;

  return new Date(trade.closedAt).getTime() >= cutoff;
}

function sortByClosedAt(first: JournalTrade, second: JournalTrade) {
  return new Date(second.closedAt).getTime() - new Date(first.closedAt).getTime();
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatR(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function titleCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function coinBadge(symbol: string, index: number) {
  const token = symbol.split('/')[0]?.slice(0, 1) ?? 'T';
  const colors = ['#f7931a', '#635bff', '#14f195', '#ff4d5e', '#22c784'];

  return (
    <i aria-hidden="true" style={{ background: colors[index % colors.length] }}>
      {token}
    </i>
  );
}
