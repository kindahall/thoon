'use client';

import { Bot, Clock3, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { TradeLimits } from '../../types/trading';
import { formatCompactUsd } from '../../utils/format';

type TradeLimitsSettingsPageProps = {
  tradeLimits: TradeLimits;
};

type MarketLimit = {
  exposure: number;
  maxSize: number;
  symbol: string;
};

const defaultMarketLimits: MarketLimit[] = [
  { exposure: 12000, maxSize: 9000, symbol: 'BTC/USDT' },
  { exposure: 9000, maxSize: 6500, symbol: 'ETH/USDT' },
  { exposure: 4500, maxSize: 3200, symbol: 'SOL/USDT' },
];

export function TradeLimitsSettingsPage({ tradeLimits }: TradeLimitsSettingsPageProps) {
  const [limits, setLimits] = useState(tradeLimits);
  const [marketLimits, setMarketLimits] = useState(defaultMarketLimits);
  const [status, setStatus] = useState('Ready');

  function updateLimit(update: Partial<TradeLimits>) {
    setLimits((currentLimits) => ({ ...currentLimits, ...update }));
  }

  function updateMarketLimit(symbol: string, update: Partial<MarketLimit>) {
    setMarketLimits((currentLimits) => currentLimits.map((marketLimit) => (marketLimit.symbol === symbol ? { ...marketLimit, ...update } : marketLimit)));
  }

  async function saveLimits() {
    setStatus('Saving');

    try {
      const savedLimits = await patchJson<TradeLimits>('/api/trade-limits', limits);
      setLimits(savedLimits);
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  function resetLimits() {
    setLimits(tradeLimits);
    setMarketLimits(defaultMarketLimits);
    setStatus('Defaults');
  }

  return (
    <section className="trade-limits-settings-page" aria-label="Trade limits settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Trade Limits</h1>
        </div>
        <div className="workspace-header__right">
          <Button icon={<RotateCcw size={15} />} onClick={resetLimits} size="sm" variant="ghost">
            Reset
          </Button>
          <Button icon={<Save size={15} />} onClick={saveLimits} size="sm" variant="primary">
            Save Limits
          </Button>
          <HelpPopover items={['Operational caps apply to manual trades and bots.', 'Risk percentages stay in Risk Rules.']} title="Trade Limits" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="trade-limits" />

        <div className="trade-limits-layout">
          <Card className="trade-limits-summary-card">
            <LimitSummary icon={<SlidersHorizontal size={18} />} label="Orders / day" value={String(limits.maxOrdersPerDay)} />
            <LimitSummary icon={<Zap size={18} />} label="Open positions" value={String(limits.maxOpenPositions)} />
            <LimitSummary icon={<ShieldCheck size={18} />} label="Exposure" value={formatCompactUsd(limits.maxTotalExposure)} />
            <LimitSummary icon={<Bot size={18} />} label="Bot slots" value={String(limits.maxBotSlotsActive)} />
          </Card>

          <div className="trade-limits-grid">
            <LimitCard icon={<SlidersHorizontal size={18} />} label="Max orders per day" onChange={(value) => updateLimit({ maxOrdersPerDay: value })} value={limits.maxOrdersPerDay} />
            <LimitCard icon={<SlidersHorizontal size={18} />} label="Max orders per hour" onChange={(value) => updateLimit({ maxOrdersPerHour: value })} value={limits.maxOrdersPerHour} />
            <LimitCard icon={<Zap size={18} />} label="Max open positions" onChange={(value) => updateLimit({ maxOpenPositions: value })} value={limits.maxOpenPositions} />
            <LimitCard icon={<ShieldCheck size={18} />} label="Max position size per pair" onChange={(value) => updateLimit({ maxPositionSizePerPair: value })} suffix="USDT" value={limits.maxPositionSizePerPair} />
            <LimitCard icon={<ShieldCheck size={18} />} label="Max total exposure" onChange={(value) => updateLimit({ maxTotalExposure: value })} suffix="USDT" value={limits.maxTotalExposure} />
            <LimitCard icon={<Bot size={18} />} label="Max bot slots active" onChange={(value) => updateLimit({ maxBotSlotsActive: value })} value={limits.maxBotSlotsActive} />
            <LimitCard icon={<Bot size={18} />} label="Max strategy executions per day" onChange={(value) => updateLimit({ maxStrategyExecutionsPerDay: value })} value={limits.maxStrategyExecutionsPerDay} />
            <LimitCard icon={<Zap size={18} />} label="Max API errors before pause" onChange={(value) => updateLimit({ maxApiErrorsBeforePause: value })} value={limits.maxApiErrorsBeforePause} />
            <LimitCard icon={<Clock3 size={18} />} label="Cooldown after losing trade" onChange={(value) => updateLimit({ cooldownAfterLossMinutes: value })} suffix="min" value={limits.cooldownAfterLossMinutes} />
            <LimitCard icon={<Clock3 size={18} />} label="Cooldown after bot error" onChange={(value) => updateLimit({ cooldownAfterBotErrorMinutes: value })} suffix="min" value={limits.cooldownAfterBotErrorMinutes} />
          </div>

          <Card className="per-market-limits-card">
            <div className="trade-limits-card-head">
              <h2>Per-market limits</h2>
              <Badge tone="neutral">{marketLimits.length} markets</Badge>
            </div>
            <div className="per-market-limits-table">
              <div className="per-market-limits-table__head">
                <span>Market</span>
                <span>Max Size</span>
                <span>Exposure</span>
                <span>Scope</span>
              </div>
              {marketLimits.map((marketLimit) => (
                <div className="per-market-limit-row" key={marketLimit.symbol}>
                  <strong>{marketLimit.symbol}</strong>
                  <input onChange={(event) => updateMarketLimit(marketLimit.symbol, { maxSize: Number(event.target.value) })} type="number" value={marketLimit.maxSize} />
                  <input onChange={(event) => updateMarketLimit(marketLimit.symbol, { exposure: Number(event.target.value) })} type="number" value={marketLimit.exposure} />
                  <span>Manual + Bots</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="trade-limits-actions">
            <strong>{status}</strong>
            <Button icon={<RotateCcw size={15} />} onClick={resetLimits} variant="ghost">
              Reset to Defaults
            </Button>
            <Button icon={<Save size={15} />} onClick={saveLimits} variant="primary">
              Save Limits
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function LimitSummary({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="limit-summary">
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

function LimitCard({ icon, label, onChange, suffix = '', value }: { icon: ReactNode; label: string; onChange: (value: number) => void; suffix?: string; value: number }) {
  return (
    <div className="limit-card">
      <span>{icon}</span>
      <strong>{label}</strong>
      <label>
        <input onChange={(event) => onChange(Number(event.target.value))} type="number" value={value} />
        {suffix ? <small>{suffix}</small> : null}
      </label>
    </div>
  );
}
