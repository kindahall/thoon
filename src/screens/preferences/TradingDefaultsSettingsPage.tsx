'use client';

import {
  BadgePercent,
  BarChart3,
  RotateCcw,
  Save,
  Shield,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { UserPreferences } from '../../types/trading';

type TradingDefaultsSettingsPageProps = {
  preferences: UserPreferences;
};

type Preset = {
  id: UserPreferences['quickPreset'];
  icon: ReactNode;
  label: string;
  shortLabel: string;
  values: Partial<UserPreferences>;
};

type TradingTabId = 'risk' | 'execution' | 'protection' | 'account' | 'presets';

type TradingTone = 'cyan' | 'green' | 'orange' | 'pink' | 'violet' | 'yellow';

type SelectOption = {
  label: string;
  value: string;
};

const presets: Preset[] = [
  { id: 'scalping', icon: <Zap size={16} />, label: 'Scalping', shortLabel: 'Scalp', values: { defaultLeverage: 5, defaultRiskPerTrade: 0.5, defaultSlippage: 0.3, quickPreset: 'scalping' } },
  { id: 'day-trading', icon: <Target size={16} />, label: 'Day Trading', shortLabel: 'Day', values: { defaultLeverage: 3, defaultRiskPerTrade: 1, defaultSlippage: 0.5, quickPreset: 'day-trading' } },
  { id: 'swing-trading', icon: <TrendingUp size={16} />, label: 'Swing Trading', shortLabel: 'Swing', values: { defaultLeverage: 2, defaultRiskPerTrade: 1.25, defaultSlippage: 0.8, quickPreset: 'swing-trading' } },
  { id: 'position-trading', icon: <BarChart3 size={16} />, label: 'Position Trading', shortLabel: 'Position', values: { defaultLeverage: 1, defaultRiskPerTrade: 0.75, defaultSlippage: 1, quickPreset: 'position-trading' } },
  { id: 'custom', icon: <SlidersHorizontal size={16} />, label: 'Custom', shortLabel: 'Custom', values: { quickPreset: 'custom' } },
];

const tradingTabs: Array<{
  id: TradingTabId;
  icon: ReactNode;
  label: string;
  tone: TradingTone;
}> = [
  { id: 'risk', icon: <BadgePercent size={15} />, label: 'Risk', tone: 'orange' },
  { id: 'execution', icon: <Zap size={15} />, label: 'Execution', tone: 'green' },
  { id: 'protection', icon: <Shield size={15} />, label: 'Protection', tone: 'pink' },
  { id: 'account', icon: <Wallet size={15} />, label: 'Account', tone: 'cyan' },
  { id: 'presets', icon: <SlidersHorizontal size={15} />, label: 'Presets', tone: 'violet' },
];

const riskOptions: SelectOption[] = [
  { label: '0.50%', value: '0.5' },
  { label: '1.00%', value: '1' },
  { label: '1.25%', value: '1.25' },
  { label: '2.00%', value: '2' },
];

const leverageOptions: SelectOption[] = [
  { label: '1x', value: '1' },
  { label: '2x', value: '2' },
  { label: '3x', value: '3' },
  { label: '5x', value: '5' },
  { label: '10x', value: '10' },
];

const slippageOptions: SelectOption[] = [
  { label: '0.30%', value: '0.3' },
  { label: '0.50%', value: '0.5' },
  { label: '0.80%', value: '0.8' },
  { label: '1.00%', value: '1' },
];

export function TradingDefaultsSettingsPage({ preferences }: TradingDefaultsSettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TradingTabId>('risk');
  const [defaults, setDefaults] = useState(preferences);
  const [previewDirection, setPreviewDirection] = useState<'long' | 'short'>('long');
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(true);
  const [stopLossEnabled, setStopLossEnabled] = useState(true);
  const [previewStatus, setPreviewStatus] = useState('Ready');
  const [saveStatus, setSaveStatus] = useState('Ready');
  const estimatedSize = useMemo(() => (0.0015 * (defaults.defaultRiskPerTrade / 1)).toFixed(4), [defaults.defaultRiskPerTrade]);
  const activeTabConfig = tradingTabs.find((tab) => tab.id === activeTab) ?? tradingTabs[0];

  function updateDefaults(values: Partial<UserPreferences>) {
    setDefaults((current) => ({ ...current, ...values }));
  }

  function resetDefaults() {
    setDefaults(preferences);
    setSaveStatus('Ready');
  }

  async function saveDefaults() {
    setSaveStatus('Saving');

    try {
      const savedDefaults = await patchJson<UserPreferences>('/api/preferences', defaults);
      setDefaults(savedDefaults);
      setSaveStatus('Saved');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return (
    <section className="trading-defaults-page" aria-label="Trading defaults settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Trading Defaults</h1>
        </div>
        <div className="workspace-header__right">
          <Badge tone="warning">Risk</Badge>
          <Badge tone="positive">Paper</Badge>
          <Badge tone="primary">Compact</Badge>
          <Button icon={<RotateCcw size={15} />} size="sm" variant="ghost" onClick={resetDefaults}>
            Reset
          </Button>
          <Button icon={<Save size={15} />} onClick={saveDefaults} size="sm" variant="primary">
            Save
          </Button>
          <HelpPopover items={['Defaults feed new orders.', 'Live still asks confirmation.']} title="Trading Defaults" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="trading-defaults" />

        <div className="trading-clean-main">
          <div className="trading-clean-tabs" role="tablist" aria-label="Trading defaults sections">
            {tradingTabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={`trading-clean-tab is-${tab.tone}${activeTab === tab.id ? ' is-active' : ''}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="trading-clean-grid">
            <div className="trading-clean-left">
              <Card className="trading-clean-summary">
                <div className="trading-clean-avatar">TD</div>
                <div className="trading-clean-name">
                  <h2>Defaults</h2>
                  <span>New orders</span>
                  <div>
                    <Badge tone="primary">{presetLabel(defaults.quickPreset)}</Badge>
                    <Badge tone="positive">{marketTypeLabel(defaults.preferredMarketType)}</Badge>
                  </div>
                </div>
                <div className="trading-clean-metrics">
                  <TradingMetric label="Risk" value={`${defaults.defaultRiskPerTrade.toFixed(2)}%`} />
                  <TradingMetric label="Leverage" value={`${defaults.defaultLeverage}x`} />
                  <TradingMetric label="Order" value={orderTypeLabel(defaults.orderType)} />
                  <TradingMetric label="Slippage" value={`${defaults.defaultSlippage.toFixed(2)}%`} />
                </div>
              </Card>

              <Card className={`trading-clean-panel is-${activeTabConfig.tone}`}>
                <div className="trading-clean-panel-head">
                  <div>
                    {activeTabConfig.icon}
                    <h2>{activeTabConfig.label}</h2>
                  </div>
                  <Badge tone={saveStatus === 'Saved' || saveStatus === 'Ready' ? 'positive' : saveStatus === 'Saving' ? 'warning' : 'neutral'}>{saveStatus}</Badge>
                </div>

                {activeTab === 'risk' ? (
                  <div className="trading-selector-grid">
                    <TradingSelectField label="Risk" options={riskOptions} tone="orange" value={String(defaults.defaultRiskPerTrade)} onChange={(value) => updateDefaults({ defaultRiskPerTrade: Number(value) })} />
                    <TradingSelectField label="Leverage" options={leverageOptions} tone="green" value={String(defaults.defaultLeverage)} onChange={(value) => updateDefaults({ defaultLeverage: Number(value) })} />
                    <TradingSelectField label="Slippage" options={slippageOptions} value={String(defaults.defaultSlippage)} onChange={(value) => updateDefaults({ defaultSlippage: Number(value) })} />
                    <TradingSelectField
                      label="Sizing"
                      options={[
                        { label: 'Risk %', value: 'risk-percent' },
                        { label: 'Fixed USDT', value: 'fixed-usdt' },
                        { label: 'Fixed Size', value: 'fixed-size' },
                      ]}
                      value={defaults.positionSizingMethod}
                      onChange={(value) => updateDefaults({ positionSizingMethod: value as UserPreferences['positionSizingMethod'] })}
                    />
                    <ToggleSelectField
                      checked={defaults.breakEvenAutomation}
                      label="Break-even"
                      onToggle={() => updateDefaults({ breakEvenAutomation: !defaults.breakEvenAutomation })}
                      options={[
                        { label: 'Off', value: 'off' },
                        { label: 'At 1R', value: 'move-to-be-at-1r' },
                        { label: 'At TP1', value: 'move-to-be-at-tp1' },
                      ]}
                      tone="pink"
                      value={defaults.breakEvenRule}
                      onChange={(value) => updateDefaults({ breakEvenRule: value as UserPreferences['breakEvenRule'] })}
                    />
                    <ToggleSelectField
                      checked={defaults.trailingStopEnabled}
                      label="Trailing"
                      onToggle={() => updateDefaults({ trailingStopEnabled: !defaults.trailingStopEnabled })}
                      options={[
                        { label: '1.00 ATR', value: '1' },
                        { label: '1.50 ATR', value: '1.5' },
                        { label: '2.00 ATR', value: '2' },
                      ]}
                      value={String(defaults.trailingStopTrailAtr)}
                      onChange={(value) => updateDefaults({ trailingStopTrailAtr: Number(value) })}
                    />
                  </div>
                ) : null}

                {activeTab === 'execution' ? (
                  <div className="trading-selector-grid">
                    <SegmentField
                      label="Direction"
                      options={[
                        { label: 'Long', value: 'long' },
                        { label: 'Short', value: 'short' },
                      ]}
                      tone="green"
                      value={previewDirection}
                      onChange={(value) => setPreviewDirection(value as 'long' | 'short')}
                    />
                    <SegmentField
                      label="Order"
                      options={[
                        { label: 'Limit', value: 'limit' },
                        { label: 'Market', value: 'market' },
                        { label: 'Stop', value: 'stop' },
                      ]}
                      value={defaults.orderType}
                      onChange={(value) => updateDefaults({ orderType: value as UserPreferences['orderType'] })}
                    />
                    <SegmentField
                      label="Market"
                      options={[
                        { label: 'Spot', value: 'spot' },
                        { label: 'Perp', value: 'perpetual' },
                        { label: 'Futures', value: 'futures' },
                      ]}
                      tone="cyan"
                      value={defaults.preferredMarketType}
                      onChange={(value) => updateDefaults({ preferredMarketType: value as UserPreferences['preferredMarketType'] })}
                    />
                    <TradingSelectField
                      label="Take Profit"
                      options={[
                        { label: 'TP Limit', value: 'tp-limit' },
                        { label: 'TP Market', value: 'tp-market' },
                        { label: 'Scale out', value: 'scale-out' },
                      ]}
                      tone="orange"
                      value={defaults.takeProfitMode}
                      onChange={(value) => updateDefaults({ takeProfitMode: value as UserPreferences['takeProfitMode'] })}
                    />
                    <TradingSelectField
                      label="Multi-TP"
                      options={[
                        { label: 'Single', value: 'single-target' },
                        { label: 'Partial', value: 'partial-take-profits' },
                        { label: 'Ladder', value: 'equal-ladder' },
                      ]}
                      tone="violet"
                      value={defaults.multiTpBehavior}
                      onChange={(value) => updateDefaults({ multiTpBehavior: value as UserPreferences['multiTpBehavior'] })}
                    />
                    <TradingSelectField
                      label="Stop Loss"
                      options={[
                        { label: 'SL Market', value: 'sl-market' },
                        { label: 'SL Limit', value: 'sl-limit' },
                      ]}
                      tone="pink"
                      value={defaults.stopLossMode}
                      onChange={(value) => updateDefaults({ stopLossMode: value as UserPreferences['stopLossMode'] })}
                    />
                  </div>
                ) : null}

                {activeTab === 'protection' ? (
                  <div className="trading-selector-grid">
                    <ToggleValue label="Take Profit" checked={takeProfitEnabled} tone="green" value={takeProfitLabel(defaults.takeProfitMode)} onToggle={() => setTakeProfitEnabled((current) => !current)} />
                    <ToggleValue label="Stop Loss" checked={stopLossEnabled} tone="pink" value={stopLossLabel(defaults.stopLossMode)} onToggle={() => setStopLossEnabled((current) => !current)} />
                    <ToggleValue label="Break-even" checked={defaults.breakEvenAutomation} tone="violet" value={defaults.breakEvenAutomation ? 'On' : 'Off'} onToggle={() => updateDefaults({ breakEvenAutomation: !defaults.breakEvenAutomation })} />
                    <ToggleValue label="Trailing" checked={defaults.trailingStopEnabled} value={`${defaults.trailingStopTrailAtr} ATR`} onToggle={() => updateDefaults({ trailingStopEnabled: !defaults.trailingStopEnabled })} />
                    <TradingValue label="Live" tone="orange" value="Confirm" />
                    <TradingValue label="Mode" tone="cyan" value="Paper first" />
                  </div>
                ) : null}

                {activeTab === 'account' ? (
                  <div className="trading-selector-grid">
                    <TradingSelectField
                      label="Exchange"
                      options={['Paper', 'Binance', 'Bybit', 'OKX', 'dYdX', 'Hyperliquid', '1inch'].map((value) => ({ label: value, value }))}
                      tone="cyan"
                      value={defaults.defaultExchange}
                      onChange={(value) => updateDefaults({ defaultExchange: value })}
                    />
                    <TradingSelectField
                      label="Account"
                      options={['Main Account', 'Paper Account', 'Bot Sandbox'].map((value) => ({ label: value, value }))}
                      value={defaults.defaultAccount}
                      onChange={(value) => updateDefaults({ defaultAccount: value })}
                    />
                    <TradingValue label="Currency" value="USDT" />
                    <TradingValue label="Est. size" tone="green" value={`${estimatedSize} BTC`} />
                    <TradingValue label="Builder" tone="violet" value="Enabled" />
                    <TradingValue label="Save state" tone={saveStatus === 'Saved' ? 'green' : 'orange'} value={saveStatus} />
                  </div>
                ) : null}

                {activeTab === 'presets' ? (
                  <div className="trading-preset-clean-grid">
                    {presets.map((preset) => (
                      <button className={defaults.quickPreset === preset.id ? 'is-active' : undefined} key={preset.id} onClick={() => updateDefaults(preset.values)} type="button">
                        {preset.icon}
                        <span>{preset.shortLabel}</span>
                        <strong>{presetSummary(preset.id)}</strong>
                      </button>
                    ))}
                  </div>
                ) : null}
              </Card>
            </div>

            <div className="trading-clean-side">
              <Card className="trading-clean-preview">
                <h2>Preview</h2>
                <div className="trading-clean-accent-line" />
                <div className="trading-clean-direction">
                  <button className={previewDirection === 'long' ? 'is-active' : undefined} onClick={() => setPreviewDirection('long')} type="button">
                    Long
                  </button>
                  <button className={previewDirection === 'short' ? 'is-active' : undefined} onClick={() => setPreviewDirection('short')} type="button">
                    Short
                  </button>
                </div>
                <PreviewRow label="Type" value={orderTypeLabel(defaults.orderType)} />
                <PreviewRow label="Size" value={`${estimatedSize} BTC`} />
                <PreviewRow label="Risk" value={`${defaults.defaultRiskPerTrade.toFixed(2)}% / ${defaults.defaultLeverage}x`} />
                <PreviewRow label="TP / SL" value={takeProfitEnabled || stopLossEnabled ? 'On' : 'Off'} />
                <Button className="trading-clean-execute" onClick={() => setPreviewStatus(`${previewDirection === 'long' ? 'Buy' : 'Sell'} checked`)} variant="primary">
                  {previewDirection === 'long' ? 'Buy' : 'Sell'} BTC/USDT
                </Button>
              </Card>

              <Card className="trading-clean-status">
                <h2>Status</h2>
                <TradingStatusRow label="Preview" tone="cyan" value={previewStatus} />
                <TradingStatusRow label="Live" tone="orange" value="Confirm" />
                <TradingStatusRow label="Save" tone={saveStatus === 'Saved' || saveStatus === 'Ready' ? 'green' : 'orange'} value={saveStatus} />
              </Card>

              <Card className="trading-clean-actions">
                <h2>Actions</h2>
                <div>
                  <button className="is-green" onClick={() => void saveDefaults()} type="button">
                    Save
                  </button>
                  <button className="is-orange" onClick={resetDefaults} type="button">
                    Reset
                  </button>
                  <button className="is-cyan" onClick={() => setPreviewStatus('Preview checked')} type="button">
                    Preview
                  </button>
                  <button className="is-violet" onClick={() => setActiveTab('presets')} type="button">
                    Preset
                  </button>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TradingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="trading-clean-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TradingSelectField({ label, onChange, options, tone, value }: { label: string; onChange: (value: string) => void; options: SelectOption[]; tone?: TradingTone; value: string }) {
  return (
    <label className={`trading-selector${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleSelectField({
  checked,
  label,
  onChange,
  onToggle,
  options,
  tone,
  value,
}: {
  checked: boolean;
  label: string;
  onChange: (value: string) => void;
  onToggle: () => void;
  options: SelectOption[];
  tone?: TradingTone;
  value: string;
}) {
  return (
    <div className={`trading-selector${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <div className="trading-toggle-select">
        <button aria-label={`${label} toggle`} className={`switch ${checked ? 'is-on' : ''}`} onClick={onToggle} type="button" />
        <select onChange={(event) => onChange(event.target.value)} value={value}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SegmentField({ label, onChange, options, tone, value }: { label: string; onChange: (value: string) => void; options: SelectOption[]; tone?: TradingTone; value: string }) {
  return (
    <div className={`trading-selector trading-selector--segment${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button className={value === option.value ? 'is-active' : undefined} key={option.value} onClick={() => onChange(option.value)} type="button">
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleValue({ checked, label, onToggle, tone, value }: { checked: boolean; label: string; onToggle: () => void; tone?: TradingTone; value: string }) {
  return (
    <div className={`trading-selector${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <div className="trading-value-toggle">
        <strong>{value}</strong>
        <button aria-label={`${label} toggle`} className={`switch ${checked ? 'is-on' : ''}`} onClick={onToggle} type="button" />
      </div>
    </div>
  );
}

function TradingValue({ label, tone, value }: { label: string; tone?: TradingTone; value: string }) {
  return (
    <div className={`trading-selector${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="trading-preview-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TradingStatusRow({ label, tone, value }: { label: string; tone: TradingTone; value: string }) {
  return (
    <div className={`trading-status-row is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function marketTypeLabel(type: UserPreferences['preferredMarketType']) {
  return type === 'spot' ? 'Spot' : type === 'perpetual' ? 'Perpetual' : 'Futures';
}

function orderTypeLabel(type: UserPreferences['orderType']) {
  return type === 'limit' ? 'Limit' : type === 'market' ? 'Market' : 'Stop';
}

function presetLabel(preset: UserPreferences['quickPreset']) {
  return presets.find((item) => item.id === preset)?.label ?? 'Custom';
}

function presetSummary(preset: UserPreferences['quickPreset']) {
  if (preset === 'scalping') {
    return '0.5% / 5x';
  }

  if (preset === 'day-trading') {
    return '1% / 3x';
  }

  if (preset === 'swing-trading') {
    return '1.25% / 2x';
  }

  if (preset === 'position-trading') {
    return '0.75% / 1x';
  }

  return 'Manual';
}

function takeProfitLabel(mode: UserPreferences['takeProfitMode']) {
  return mode === 'tp-limit' ? 'TP Limit' : mode === 'tp-market' ? 'TP Market' : 'Scale out';
}

function stopLossLabel(mode: UserPreferences['stopLossMode']) {
  return mode === 'sl-market' ? 'SL Market' : 'SL Limit';
}
