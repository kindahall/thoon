'use client';

import { Braces, Plus, Save, ShieldCheck, TestTube2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge, Button, Card, HelpPopover, Toggle } from '../../components/ui';
import { patchJson, postJson } from '../../services/api-client';
import { evaluateRiskEngine } from '../../services/risk-engine';
import type { MarketPair, Timeframe } from '../../types/market';
import type { RiskRules, Strategy, StrategyCondition, TradeLimits } from '../../types/trading';

type NewStrategyPageProps = {
  initialPair?: string;
  initialStrategy?: Strategy;
  marketPairs: MarketPair[];
  riskRules: RiskRules;
  tradeLimits: TradeLimits;
};

const defaultEntryConditions: StrategyCondition[] = [
  { connector: 'IF', field: 'Price', id: 'entry-1', operator: 'crosses-above', value: 'EMA 50' },
  { connector: 'AND', field: 'RSI', id: 'entry-2', operator: 'greater-than', value: '50' },
  { connector: 'AND', field: 'Volume', id: 'entry-3', operator: 'greater-than', value: '20D avg' },
];

const defaultExitConditions: StrategyCondition[] = [
  { connector: 'IF', field: 'Price', id: 'exit-1', operator: 'crosses-below', value: 'EMA 200' },
  { connector: 'OR', field: 'RSI', id: 'exit-2', operator: 'greater-than', value: '70' },
];

export function NewStrategyPage({ initialPair, initialStrategy, marketPairs, riskRules, tradeLimits }: NewStrategyPageProps) {
  const [name, setName] = useState(initialStrategy?.name ?? 'New Strategy');
  const [market, setMarket] = useState(initialStrategy?.market ?? initialPair ?? marketPairs[0]?.symbol ?? 'BTC/USDT');
  const [timeframe, setTimeframe] = useState<Timeframe>(initialStrategy?.timeframe ?? '15m');
  const [strategyType, setStrategyType] = useState<Strategy['type']>(initialStrategy?.type ?? 'trend');
  const [entryConditions, setEntryConditions] = useState(initialStrategy?.entryConditions?.length ? initialStrategy.entryConditions : defaultEntryConditions);
  const [exitConditions, setExitConditions] = useState(initialStrategy?.exitConditions?.length ? initialStrategy.exitConditions : defaultExitConditions);
  const [riskPerTrade, setRiskPerTrade] = useState(initialStrategy?.riskPerTrade ?? riskRules.maxRiskPerTrade);
  const [accountBalance, setAccountBalance] = useState(initialStrategy?.riskSettings?.accountBalance ?? 10000);
  const [positionSizing, setPositionSizing] = useState(initialStrategy?.riskSettings?.positionSizing ?? 'risk-percent');
  const [maxOpenTrades, setMaxOpenTrades] = useState(initialStrategy?.riskSettings?.maxOpenTrades ?? tradeLimits.maxOpenPositions);
  const [stopLoss, setStopLoss] = useState(initialStrategy?.riskSettings?.stopLoss ?? 'Required');
  const [takeProfit, setTakeProfit] = useState(initialStrategy?.riskSettings?.takeProfit ?? '2R');
  const [trailingStop, setTrailingStop] = useState(initialStrategy?.riskSettings?.trailingStop ?? true);
  const [rrTarget, setRrTarget] = useState(initialStrategy?.riskSettings?.rrTarget ?? 2);
  const [stopRequired, setStopRequired] = useState(initialStrategy?.riskSettings?.stopRequired ?? riskRules.blockOrdersWithoutStop);
  const [status, setStatus] = useState('Draft');
  const riskPreview = useMemo(
    () =>
      evaluateRiskEngine({
        action: 'strategy-preview',
        mode: 'preview',
        order: {
          accountBalance,
          availableBalance: accountBalance,
          dailyLossPercent: 0,
          entry: 100,
          leverage: 1,
          marginRequired: accountBalance * (riskPerTrade / 100),
          openPositions: 0,
          ordersToday: 0,
          riskPercent: riskPerTrade,
          stopLoss: stopRequired ? 98 : undefined,
          symbol: market,
          weeklyLossPercent: 0,
        },
        riskRules,
        tradeLimits,
      }),
    [accountBalance, market, riskPerTrade, riskRules, stopRequired, tradeLimits],
  );

  function addCondition(kind: 'entry' | 'exit') {
    const condition: StrategyCondition = {
      connector: kind === 'entry' ? 'AND' : 'OR',
      field: 'RSI',
      id: `${kind}-${Date.now()}`,
      operator: kind === 'entry' ? 'less-than' : 'greater-than',
      value: kind === 'entry' ? '35' : '70',
    };

    if (kind === 'entry') {
      setEntryConditions((currentConditions) => [...currentConditions, condition]);
      return;
    }

    setExitConditions((currentConditions) => [...currentConditions, condition]);
  }

  function updateCondition(kind: 'entry' | 'exit', id: string, update: Partial<StrategyCondition>) {
    const updater = (condition: StrategyCondition) => (condition.id === id ? { ...condition, ...update } : condition);

    if (kind === 'entry') {
      setEntryConditions((currentConditions) => currentConditions.map(updater));
      return;
    }

    setExitConditions((currentConditions) => currentConditions.map(updater));
  }

  async function saveStrategy() {
    setStatus('Saving');

    try {
      const payload = {
        entryConditions,
        exitConditions,
        market,
        name,
        positionDraft: initialStrategy?.positionDraft,
        riskPerTrade,
        riskSettings: {
          accountBalance,
          maxOpenTrades,
          positionSizing,
          rrTarget,
          stopLoss,
          stopRequired,
          takeProfit,
          trailingStop,
        },
        setupSnapshot: initialStrategy?.setupSnapshot,
        sourceSetupId: initialStrategy?.sourceSetupId,
        status: 'draft',
        timeframe,
        type: strategyType,
      };
      await (initialStrategy ? patchJson<Strategy>(`/api/strategies/${encodeURIComponent(initialStrategy.id)}`, payload) : postJson<Strategy>('/api/strategies', payload));
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return (
    <section className="new-strategy-page" aria-label="Create strategy">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>{initialStrategy ? 'Edit Strategy' : 'New Strategy'}</h1>
          <p>Build entry, exit and risk rules before creating a bot.</p>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={saveStrategy} size="sm" variant="ghost">
            Save
          </Button>
          <Link className="ui-button ui-button--secondary ui-button--sm" href={`/backtest?pair=${encodeURIComponent(market)}`}>
            <span className="ui-button__icon">
              <TestTube2 size={15} />
            </span>
            <span>Backtest</span>
          </Link>
          <Link className="ui-button ui-button--primary ui-button--sm" href={`/backtest?pair=${encodeURIComponent(market)}`}>
            <span className="ui-button__icon">
              <TestTube2 size={15} />
            </span>
            <span>Backtest avant bot</span>
          </Link>
          <HelpPopover items={['Conditions can be reused for backtests and bots.', 'Stop-loss remains required by risk rules.']} title="Create Strategy" />
        </div>
      </div>

      <div className="strategy-builder-layout">
        <Card className="strategy-builder-main">
          <div className="strategy-builder-form">
            <label>
              <span>Strategy Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>Market / Pair</span>
              <select value={market} onChange={(event) => setMarket(event.target.value)}>
                {marketPairs.map((pair) => (
                  <option key={pair.symbol} value={pair.symbol}>
                    {pair.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Timeframe</span>
              <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)}>
                {(['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M', '1y'] satisfies Timeframe[]).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Strategy Type</span>
              <select value={strategyType} onChange={(event) => setStrategyType(event.target.value as Strategy['type'])}>
                <option value="trend">Trend</option>
                <option value="breakout">Breakout</option>
                <option value="mean-reversion">Mean Reversion</option>
                <option value="grid">Grid</option>
              </select>
            </label>
          </div>

          <ConditionBlock conditions={entryConditions} kind="entry" onAdd={() => addCondition('entry')} onUpdate={updateCondition} title="Entry Conditions" />
          <ConditionBlock conditions={exitConditions} kind="exit" onAdd={() => addCondition('exit')} onUpdate={updateCondition} title="Exit Conditions" />
        </Card>

        <Card className="strategy-risk-card">
          <div className="strategy-risk-head">
            <ShieldCheck size={20} />
            <div>
              <h2>Risk Settings</h2>
              <span>{riskPreview.allowed ? status : riskPreview.suggestedCorrection}</span>
            </div>
            <Badge tone={riskPreview.allowed ? (riskPreview.warnings.length ? 'warning' : 'positive') : 'negative'}>{riskPreview.severity === 'none' ? 'ready' : riskPreview.severity}</Badge>
          </div>
          <RiskField label="Risk per trade" onChange={setRiskPerTrade} suffix="%" value={riskPerTrade} />
          <RiskField label="Account balance" onChange={setAccountBalance} suffix="USDT" value={accountBalance} />
          <label className="risk-select-field">
            <span>Position sizing</span>
            <select value={positionSizing} onChange={(event) => setPositionSizing(event.target.value)}>
              <option value="risk-percent">Risk percent</option>
              <option value="fixed-usdt">Fixed USDT</option>
              <option value="fixed-size">Fixed size</option>
            </select>
          </label>
          <RiskField label="Max open trades" onChange={setMaxOpenTrades} value={maxOpenTrades} />
          <label className="risk-select-field">
            <span>Stop Loss</span>
            <select value={stopLoss} onChange={(event) => setStopLoss(event.target.value)}>
              <option>Required</option>
              <option>ATR based</option>
              <option>Structure low/high</option>
            </select>
          </label>
          <label className="risk-select-field">
            <span>Take Profit</span>
            <select value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)}>
              <option>2R</option>
              <option>Scale out</option>
              <option>Trailing only</option>
            </select>
          </label>
          <RiskField label="R/R target" onChange={setRrTarget} suffix="R" value={rrTarget} />
          <Toggle checked={trailingStop} label="Trailing Stop" onClick={() => setTrailingStop((current) => !current)} />
          <Toggle checked={stopRequired} label="Stop-loss required" onClick={() => setStopRequired((current) => !current)} />
          <div className={`strategy-risk-preview is-${riskPreview.allowed ? 'passed' : 'blocked'}`}>
            <ShieldCheck size={16} />
            <span>Risk Engine</span>
            <strong>{riskPreview.allowed ? `${riskPreview.warnings.length} warnings` : `${riskPreview.blockers.length} blockers`}</strong>
          </div>
          <div className="strategy-builder-actions">
            <Button icon={<Save size={15} />} onClick={saveStrategy} variant="ghost">
              Save
            </Button>
            <Link className="ui-button ui-button--secondary ui-button--md" href={`/backtest?pair=${encodeURIComponent(market)}`}>
              <span className="ui-button__icon">
                <TestTube2 size={15} />
              </span>
              <span>Backtest</span>
            </Link>
            <Link className="ui-button ui-button--primary ui-button--md" href={`/backtest?pair=${encodeURIComponent(market)}`}>
              <span className="ui-button__icon">
                <TestTube2 size={15} />
              </span>
              <span>Backtest avant bot</span>
            </Link>
          </div>
        </Card>
      </div>
    </section>
  );
}

function ConditionBlock({
  conditions,
  kind,
  onAdd,
  onUpdate,
  title,
}: {
  conditions: StrategyCondition[];
  kind: 'entry' | 'exit';
  onAdd: () => void;
  onUpdate: (kind: 'entry' | 'exit', id: string, update: Partial<StrategyCondition>) => void;
  title: string;
}) {
  return (
    <div className="condition-block">
      <div className="condition-block__head">
        <h2>{title}</h2>
        <div>
          <Button icon={<Plus size={14} />} onClick={onAdd} size="sm" variant="ghost">
            Add Condition
          </Button>
          <Button icon={<Braces size={14} />} onClick={onAdd} size="sm" variant="ghost">
            Add Group
          </Button>
        </div>
      </div>
          <div className="condition-list">
            {conditions.map((condition) => (
              <div className="condition-row" key={condition.id}>
            <select aria-label={`${condition.id} connector`} value={condition.connector} onChange={(event) => onUpdate(kind, condition.id, { connector: event.target.value as StrategyCondition['connector'] })}>
              <option value="IF">IF</option>
              <option value="AND">AND</option>
              <option value="OR">OR</option>
            </select>
            <select aria-label={`${condition.id} selector`} value={condition.field} onChange={(event) => onUpdate(kind, condition.id, { field: event.target.value })}>
              <option>Price</option>
              <option>Volume</option>
              <option>RSI</option>
              <option>EMA</option>
              <option>MACD</option>
            </select>
            <select aria-label={`${condition.id} operator`} value={condition.operator} onChange={(event) => onUpdate(kind, condition.id, { operator: event.target.value as StrategyCondition['operator'] })}>
              <option value="crosses-above">Crosses above</option>
              <option value="crosses-below">Crosses below</option>
              <option value="greater-than">Greater than</option>
              <option value="less-than">Less than</option>
            </select>
                <input aria-label={`${condition.id} value`} value={condition.value} onChange={(event) => onUpdate(kind, condition.id, { value: event.target.value })} />
              </div>
            ))}
            <div className={`condition-then-row condition-then-row--${kind}`}>
              <span>THEN</span>
              <strong>{kind === 'entry' ? 'Enter Long' : 'Exit Market'}</strong>
            </div>
          </div>
        </div>
      );
}

function RiskField({ label, onChange, suffix, value }: { label: string; onChange: (value: number) => void; suffix?: string; value: number }) {
  return (
    <label className="risk-number-field">
      <span>{label}</span>
      <div>
        <input onChange={(event) => onChange(Number(event.target.value))} type="number" value={value} />
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </label>
  );
}
