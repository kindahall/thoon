'use client';

import { ArrowDown, ArrowUp, Copy, Edit3, Funnel, MoreVertical, Pencil, Play, Plus, Search, ShieldCheck, TrendingUp, X, Zap } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import { Badge, Card, EmptyState, HelpPopover, IconButton } from '../../components/ui';
import { postJson } from '../../services/api-client';
import type { Strategy } from '../../types/trading';
import { formatPercent } from '../../utils/format';

type StrategiesListPageProps = {
  strategies: Strategy[];
};

type StrategyFilter = 'all' | Strategy['status'];
type StrategySort = 'recent' | 'performance' | 'name';
type QuickPanelTab = 'builder' | 'backtest' | 'properties';

const filters: Array<{ label: string; value: StrategyFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Draft', value: 'draft' },
  { label: 'Archived', value: 'archived' },
];

export function StrategiesListPage({ strategies }: StrategiesListPageProps) {
  const [strategyRecords, setStrategyRecords] = useState(strategies);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StrategyFilter>('all');
  const [sort, setSort] = useState<StrategySort>('recent');
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

  async function duplicateStrategy(strategy: Strategy) {
    setActionStatus(`Duplicating ${strategy.name}`);

    try {
      const duplicated = await postJson<Strategy>(`/api/strategies/${encodeURIComponent(strategy.id)}/duplicate`);
      setStrategyRecords((currentStrategies) => [duplicated, ...currentStrategies]);
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
      setActionStatus(`${duplicated.name} created locally`);
    }
  }

  return (
    <section className="strategies-list-page" aria-label="Strategies list">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Strategies</h1>
          <p>Single strategy mode: jimmy only, adapted by crypto and timeframe.</p>
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
            Adapt Jimmy
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
                  <option value="recent">Recent</option>
                  <option value="performance">Performance</option>
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
                  filteredStrategies.map((strategy) => (
                    <div className="strategy-row" key={strategy.id}>
                      <Link className="strategy-row__name" href={`/strategies/${strategy.id}`}>
                        <span>
                          <TrendingUp size={18} />
                        </span>
                        <div>
                          <strong>{strategy.name}</strong>
                          <small>Risk {strategy.riskPerTrade}%</small>
                        </div>
                      </Link>
                      <Badge tone="neutral">{formatStrategyType(strategy.type)}</Badge>
                      <span>{strategy.market}</span>
                      <span>{strategy.timeframe}</span>
                      <Badge tone={strategy.status === 'active' ? 'positive' : strategy.status === 'draft' ? 'warning' : 'neutral'}>{strategy.status}</Badge>
                      <div className="strategy-performance">
                        <strong className={strategy.performance30d >= 0 ? 'positive' : 'negative'}>{formatPercent(strategy.performance30d)}</strong>
                        <span>ROI</span>
                        <StrategySparkline positive={strategy.performance30d >= 0} />
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
                  ))
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
            <Link className="strategy-new-link" href="/bots/new?from=strategy">
              Create Bot
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
    case 'performance':
      return second.performance30d - first.performance30d;
    case 'name':
      return first.name.localeCompare(second.name);
    case 'recent':
      return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
  }
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
