'use client';

import { ArrowDown, ArrowUp, Copy, Edit3, Funnel, MoreVertical, Pencil, Play, Plus, Search, ShieldCheck, TrendingUp, X, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Badge, Card, EmptyState, HelpPopover, IconButton } from '../../components/ui';
import { postJson } from '../../services/api-client';
import type { Strategy } from '../../types/trading';
import { isResearchOnlyStrategy } from '../../utils/strategy-catalog';
import type { EndorsedStrategy } from '../../utils/strategy-endorsement';
import { formatPercent } from '../../utils/format';

type StrategiesListPageProps = {
  endorsedStrategies: EndorsedStrategy[];
  strategies: Strategy[];
};

const STRATEGIES_PAGE_SIZE = 10;

type StrategyFilter = 'all' | Strategy['status'];
type StrategySort = 'name' | 'performance-asc' | 'performance-desc' | 'recent';
type QuickPanelTab = 'builder' | 'backtest' | 'properties';

const filters: Array<{ label: string; value: StrategyFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Draft', value: 'draft' },
  { label: 'Archived', value: 'archived' },
];

export function StrategiesListPage({ endorsedStrategies, strategies }: StrategiesListPageProps) {
  const [strategyRecords, setStrategyRecords] = useState(strategies);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StrategyFilter>('all');
  const [sort, setSort] = useState<StrategySort>('performance-desc');
  const [page, setPage] = useState(0);
  const [quickPanelOpen, setQuickPanelOpen] = useState(true);
  const [quickPanelTab, setQuickPanelTab] = useState<QuickPanelTab>('builder');
  const [actionStatus, setActionStatus] = useState('Ready');
  const filteredStrategies = useMemo(() => {
    return strategyRecords
      .filter((strategy) => filter === 'all' || strategy.status === filter)
      .filter((strategy) => {
        const haystack = `${strategy.name} ${strategy.market} ${strategy.type} ${strategy.timeframe}`.toLowerCase();

        return haystack.includes(query.toLowerCase());
      })
      .sort((first, second) => sortStrategies(first, second, sort));
  }, [filter, query, sort, strategyRecords]);
  const pageCount = Math.max(1, Math.ceil(filteredStrategies.length / STRATEGIES_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleStrategies = filteredStrategies.slice(currentPage * STRATEGIES_PAGE_SIZE, currentPage * STRATEGIES_PAGE_SIZE + STRATEGIES_PAGE_SIZE);
  const visibleStart = filteredStrategies.length ? currentPage * STRATEGIES_PAGE_SIZE + 1 : 0;
  const visibleEnd = Math.min(filteredStrategies.length, (currentPage + 1) * STRATEGIES_PAGE_SIZE);
  const endorsedByStrategyId = useMemo(() => new Map(endorsedStrategies.map((item) => [item.strategy.id, item])), [endorsedStrategies]);

  useEffect(() => {
    setPage(0);
  }, [filter, query, sort]);

  async function duplicateStrategy(strategy: Strategy) {
    setActionStatus(`Duplicating ${strategy.name}`);

    try {
      const duplicated = await postJson<Strategy>(`/api/strategies/${encodeURIComponent(strategy.id)}/duplicate`);
      setStrategyRecords((currentStrategies) => [duplicated, ...currentStrategies]);
      setPage(0);
      setActionStatus(`${duplicated.name} created`);
    } catch {
      const duplicated: Strategy = {
        ...strategy,
        id: `${strategy.id}-copy-${Date.now()}`,
        name: `${strategy.name} Copy`,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      };

      setStrategyRecords((currentStrategies) => [duplicated, ...currentStrategies]);
      setPage(0);
      setActionStatus(`${duplicated.name} created locally`);
    }
  }

  return (
    <section className="strategies-list-page" aria-label="Strategies list">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Strategies</h1>
          <p>Named strategies, agent variants and protected core research.</p>
        </div>
        <div className="workspace-header__right">
          <Link className="ui-button ui-button--secondary ui-button--sm" href="/strategies/core-lab">
            <span className="ui-button__icon">
              <ShieldCheck size={15} />
            </span>
            Jimmy Lab
          </Link>
          <Link className="strategy-new-link" href="/strategies/new">
            <Plus size={15} />
            New Strategy
          </Link>
          <HelpPopover items={['Details open from the strategy name.', 'Testing stays paper until a bot is launched.']} title="Strategies" />
        </div>
      </div>

      <div className="strategies-list-layout">
        <Card className="strategies-list-card">
          {strategyRecords.length === 0 ? (
            <EmptyState
              actionHref="/strategies/new"
              actionLabel="Create Strategy"
              description="Start from a clean rule set or a template."
              icon={<TrendingUp size={20} />}
              secondaryActionHref="/strategies/new?template=trend"
              secondaryActionLabel="Use Template"
              title="No strategies"
            />
          ) : (
            <>
              <div className="strategy-toolbar">
                <label className="strategy-search">
                  <Search size={16} />
                  <input aria-label="Search strategies" onChange={(event) => setQuery(event.target.value)} placeholder="Search strategies" value={query} />
                </label>
                <select aria-label="Sort strategies" onChange={(event) => setSort(event.target.value as StrategySort)} value={sort}>
                  <option value="performance-desc">Best performance</option>
                  <option value="performance-asc">Worst performance</option>
                  <option value="recent">Recent</option>
                  <option value="name">Name</option>
                </select>
              </div>

              <div className="strategy-filters" aria-label="Strategy filters">
                {filters.map((item) => (
                  <button className={filter === item.value ? 'is-active' : undefined} key={item.value} onClick={() => setFilter(item.value)} type="button">
                    {item.label}
                    <span>{countByFilter(strategyRecords, item.value)}</span>
                  </button>
                ))}
              </div>

              <div className="strategy-list-meta">
                <span>{visibleStart}-{visibleEnd} of {filteredStrategies.length}</span>
                <Badge tone={sort === 'performance-desc' ? 'positive' : sort === 'performance-asc' ? 'warning' : 'neutral'}>{formatStrategySort(sort)}</Badge>
              </div>

              <div className="strategies-table">
                <div className="strategies-table__head">
                  <span>Strategy</span>
                  <span>Type</span>
                  <span>Market</span>
                  <span>Timeframe</span>
                  <span>Status</span>
                  <span>Performance 30D</span>
                  <span>Actions</span>
                </div>
                {filteredStrategies.length > 0 ? (
                  visibleStrategies.map((strategy) => {
                    const endorsed = endorsedByStrategyId.get(strategy.id);

                    return (
                    <div className={`strategy-row${endorsed ? ' strategy-row--trusted-alert' : ''}`} key={strategy.id}>
                      <Link className="strategy-row__name" href={`/strategies/${strategy.id}`}>
                        <span>
                          <TrendingUp size={18} />
                        </span>
                        <div>
                          <strong>{strategy.name}</strong>
                          <small>{endorsed ? `Fiable · score ${endorsed.score}/100 · paper ${endorsed.paperSession.rMultiple.toFixed(2)}R` : isResearchOnlyStrategy(strategy) ? 'TradingView concept · real adapted backtest' : `Risk ${strategy.riskPerTrade}%`}</small>
                        </div>
                      </Link>
                      <Badge tone="neutral">{formatStrategyType(strategy.type)}</Badge>
                      <span>{strategy.market}</span>
                      <span>{strategy.timeframe}</span>
                      <Badge tone={endorsed ? 'negative' : strategy.status === 'active' ? 'positive' : strategy.status === 'draft' ? 'warning' : 'neutral'}>{endorsed ? 'fiable' : strategy.status}</Badge>
                      <div className="strategy-performance">
                        {isResearchOnlyStrategy(strategy) && strategy.performance30d === 0 ? (
                          <>
                            <strong>No run</strong>
                            <span>adapted</span>
                          </>
                        ) : (
                          <>
                            <strong className={strategy.performance30d >= 0 ? 'positive' : 'negative'}>{formatPercent(strategy.performance30d)}</strong>
                            <span>ROI</span>
                            <StrategySparkline positive={strategy.performance30d >= 0} />
                          </>
                        )}
                      </div>
                      <div className="strategy-actions">
                        <Link aria-label={`Test ${strategy.name}`} className="ui-icon-button" href={`/backtest?strategyId=${encodeURIComponent(strategy.id)}`} title={`Test ${strategy.name}`}>
                          <span className="sr-only">Test {strategy.name}</span>
                          <Play size={15} />
                        </Link>
                        <IconButton icon={<Copy size={15} />} label={`Duplicate ${strategy.name}`} onClick={() => void duplicateStrategy(strategy)} />
                        <Link aria-label={`Edit ${strategy.name}`} className="ui-icon-button" href={`/strategies/${strategy.id}`} title={`Edit ${strategy.name}`}>
                          <span className="sr-only">Edit {strategy.name}</span>
                          <Pencil size={15} />
                        </Link>
                        <IconButton icon={<MoreVertical size={15} />} label={`More ${strategy.name}`} onClick={() => setActionStatus(`${strategy.name} actions ready`)} />
                      </div>
                    </div>
                    );
                  })
                ) : (
                  <EmptyState
                    actionHref="/strategies/new"
                    actionLabel="Create Strategy"
                    description="Adjust search or start a new rule set."
                    icon={<Search size={20} />}
                    title="No match"
                  />
                )}
              </div>

              <PaginationControls count={filteredStrategies.length} onPageChange={setPage} page={currentPage} pageCount={pageCount} />
            </>
          )}
        </Card>

        {quickPanelOpen ? <Card className="strategy-quick-builder">
          <div className="strategy-panel-tabs" aria-label="Strategy panel tabs">
            <button className={quickPanelTab === 'builder' ? 'is-active' : undefined} onClick={() => setQuickPanelTab('builder')} type="button">Builder</button>
            <button className={quickPanelTab === 'backtest' ? 'is-active' : undefined} onClick={() => setQuickPanelTab('backtest')} type="button">Backtest</button>
            <button className={quickPanelTab === 'properties' ? 'is-active' : undefined} onClick={() => setQuickPanelTab('properties')} type="button">Properties</button>
            <button aria-label="Close builder" onClick={() => setQuickPanelOpen(false)} type="button">
              <X size={15} />
            </button>
          </div>
          <div className="strategy-builder-head">
            <div>
              <h2>
                New Strategy
                <Edit3 size={14} />
              </h2>
            </div>
            <Badge tone="warning">Draft</Badge>
          </div>
          {quickPanelTab === 'builder' ? (
            <div className="strategy-builder-flow">
              <BuilderStep icon={<Funnel size={19} />} label="Conditions" tone="purple" value="Define the market conditions that must be met." />
              <BuilderStep icon={<ArrowUp size={19} />} label="Entry" tone="positive" value="Set up entry rules and order types." />
              <BuilderStep icon={<ArrowDown size={19} />} label="Exit" tone="negative" value="Define exit rules and take profit / stop loss." />
              <BuilderStep icon={<ShieldCheck size={19} />} label="Risk" tone="primary" value="Configure position sizing, leverage and risk limits." />
              <BuilderStep icon={<Zap size={19} />} label="Actions" tone="warning" value="Set alerts, webhooks or custom actions." />
            </div>
          ) : null}
          {quickPanelTab === 'backtest' ? <div className="strategy-builder-flow"><BuilderStep icon={<Play size={19} />} label="Backtest" tone="primary" value="Open the selected strategy in the Backtest lab." /></div> : null}
          {quickPanelTab === 'properties' ? <div className="strategy-builder-flow"><BuilderStep icon={<Edit3 size={19} />} label="Properties" tone="warning" value="Name, market, timeframe and status are edited in the strategy builder." /></div> : null}
          <Link className="strategy-add-block" href="/strategies/new">
            <Plus size={16} />
            Add Block
          </Link>
          <div className="strategy-panel-actions">
            <Link className="strategy-secondary-link" href="/strategies/new">
              Save Strategy
            </Link>
            <Link className="strategy-new-link" href="/backtest">
              Backtest avant bot
            </Link>
          </div>
          <span className="strategy-autosave">{actionStatus}</span>
        </Card> : null}
      </div>
    </section>
  );
}

function BuilderStep({ icon, label, tone, value }: { icon: ReactNode; label: string; tone: 'purple' | 'positive' | 'negative' | 'primary' | 'warning'; value: string }) {
  return (
    <div className={`builder-step builder-step--${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{label}</strong>
        <small>{value}</small>
      </div>
      <Plus size={14} />
    </div>
  );
}

function StrategySparkline({ positive }: { positive: boolean }) {
  const points = positive ? [34, 38, 46, 70, 59, 76, 64, 68] : [76, 48, 56, 35, 50, 32, 40, 28];

  return (
    <i className={positive ? 'strategy-sparkline is-positive' : 'strategy-sparkline is-negative'} aria-hidden="true">
      {points.map((point, index) => (
        <span key={`${point}-${index}`} style={{ height: `${point}%` }} />
      ))}
    </i>
  );
}

function countByFilter(strategies: Strategy[], filter: StrategyFilter) {
  if (filter === 'all') {
    return strategies.length;
  }

  return strategies.filter((strategy) => strategy.status === filter).length;
}

function sortStrategies(first: Strategy, second: Strategy, sort: StrategySort) {
  switch (sort) {
    case 'performance-desc':
      return second.performance30d - first.performance30d;
    case 'performance-asc':
      return first.performance30d - second.performance30d;
    case 'name':
      return first.name.localeCompare(second.name);
    case 'recent':
      return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
  }
}

function formatStrategySort(sort: StrategySort) {
  switch (sort) {
    case 'performance-desc':
      return 'Best to worst';
    case 'performance-asc':
      return 'Worst to best';
    case 'name':
      return 'A to Z';
    case 'recent':
      return 'Recent';
  }
}

function PaginationControls({ count, onPageChange, page, pageCount }: { count: number; onPageChange: (page: number) => void; page: number; pageCount: number }) {
  if (count <= STRATEGIES_PAGE_SIZE) {
    return (
      <div className="strategy-pagination">
        <span>Page 1 / 1</span>
      </div>
    );
  }

  return (
    <div className="strategy-pagination">
      <button disabled={page <= 0} onClick={() => onPageChange(page - 1)} type="button">
        Previous
      </button>
      <span>Page {page + 1} / {pageCount}</span>
      <button disabled={page + 1 >= pageCount} onClick={() => onPageChange(page + 1)} type="button">
        Next
      </button>
    </div>
  );
}

function formatStrategyType(type: Strategy['type']) {
  switch (type) {
    case 'mean-reversion':
      return 'Mean Rev.';
    case 'breakout':
      return 'Breakout';
    case 'trend':
      return 'Trend';
    case 'grid':
      return 'Grid';
  }
}
