'use client';

import {
  BadgePercent,
  BarChart3,
  ChevronDown,
  Gauge,
  RotateCcw,
  Save,
  Shield,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Button, Card, HelpPopover, InfoButton } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { UserPreferences } from '../../types/trading';

type TradingDefaultsSettingsPageProps = {
  preferences: UserPreferences;
};

type Preset = {
  id: UserPreferences['quickPreset'];
  icon: ReactNode;
  label: string;
  values: Partial<UserPreferences>;
};

const presets: Preset[] = [
  { id: 'scalping', icon: <Zap size={16} />, label: 'Scalping', values: { defaultLeverage: 5, defaultRiskPerTrade: 0.5, defaultSlippage: 0.3, quickPreset: 'scalping' } },
  { id: 'day-trading', icon: <Target size={16} />, label: 'Day Trading', values: { defaultLeverage: 3, defaultRiskPerTrade: 1, defaultSlippage: 0.5, quickPreset: 'day-trading' } },
  { id: 'swing-trading', icon: <TrendingUp size={16} />, label: 'Swing Trading', values: { defaultLeverage: 2, defaultRiskPerTrade: 1.25, defaultSlippage: 0.8, quickPreset: 'swing-trading' } },
  { id: 'position-trading', icon: <BarChart3 size={16} />, label: 'Position Trading', values: { defaultLeverage: 1, defaultRiskPerTrade: 0.75, defaultSlippage: 1, quickPreset: 'position-trading' } },
  { id: 'custom', icon: <SlidersHorizontal size={16} />, label: 'Custom', values: { quickPreset: 'custom' } },
];

export function TradingDefaultsSettingsPage({ preferences }: TradingDefaultsSettingsPageProps) {
  const [defaults, setDefaults] = useState(preferences);
  const [previewDirection, setPreviewDirection] = useState<'long' | 'short'>('long');
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(true);
  const [stopLossEnabled, setStopLossEnabled] = useState(true);
  const [previewStatus, setPreviewStatus] = useState('Preview ready');
  const [saveStatus, setSaveStatus] = useState('Ready');
  const estimatedSize = useMemo(() => (0.0015 * (defaults.defaultRiskPerTrade / 1)).toFixed(4), [defaults.defaultRiskPerTrade]);

  function updateDefaults(values: Partial<UserPreferences>) {
    setDefaults((current) => ({ ...current, ...values }));
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
          <h1>Trading Defaults</h1>
          <p>Configure how orders and positions behave by default.</p>
        </div>
        <div className="workspace-header__right">
          <Button icon={<RotateCcw size={15} />} size="sm" variant="ghost" onClick={() => setDefaults(preferences)}>
            Reset
          </Button>
          <Button icon={<Save size={15} />} onClick={saveDefaults} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Defaults feed the Position Builder.', 'Live orders still require risk confirmation.']} title="Trading Defaults" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="trading-defaults" />

        <div className="trading-defaults-layout">
          <div className="trading-defaults-main">
            <div className="trading-defaults-head">
              <div>
                <h2>Trading Defaults</h2>
                <p>Default behavior for new orders and position setups.</p>
              </div>
            </div>

            <div className="trading-settings-grid">
              <TradingSettingCard icon={<BadgePercent size={17} />} info="Risk used by new position drafts." title="Default Risk per Trade">
                <select className="trading-select" value={String(defaults.defaultRiskPerTrade)} onChange={(event) => updateDefaults({ defaultRiskPerTrade: Number(event.target.value) })}>
                  <option value="0.5">0.50%</option>
                  <option value="1">1.00%</option>
                  <option value="1.25">1.25%</option>
                  <option value="2">2.00%</option>
                </select>
                <RangeControl maxLabel="5%" minLabel="0.1%" value={defaults.defaultRiskPerTrade} />
              </TradingSettingCard>

              <TradingSettingCard icon={<Gauge size={17} />} info="Maximum leverage prefilled in the order panel." title="Default Leverage">
                <select className="trading-select" value={String(defaults.defaultLeverage)} onChange={(event) => updateDefaults({ defaultLeverage: Number(event.target.value) })}>
                  <option value="1">1x</option>
                  <option value="2">2x</option>
                  <option value="3">3x</option>
                  <option value="5">5x</option>
                  <option value="10">10x</option>
                </select>
                <RangeControl maxLabel="100x" minLabel="1x" value={defaults.defaultLeverage} />
              </TradingSettingCard>

              <TradingSettingCard icon={<SlidersHorizontal size={17} />} info="Order type selected when a new order opens." title="Default Order Type">
                <select className="trading-select" value={defaults.orderType} onChange={(event) => updateDefaults({ orderType: event.target.value as UserPreferences['orderType'] })}>
                  <option value="limit">Limit</option>
                  <option value="market">Market</option>
                  <option value="stop">Stop</option>
                </select>
              </TradingSettingCard>

              <TradingSettingCard icon={<BarChart3 size={17} />} info="Market type used by new setups." title="Preferred Market Type">
                <div className="segmented-options">
                  {(['spot', 'perpetual', 'futures'] as const).map((type) => (
                    <button className={defaults.preferredMarketType === type ? 'is-active' : undefined} key={type} onClick={() => updateDefaults({ preferredMarketType: type })} type="button">
                      {marketTypeLabel(type)}
                    </button>
                  ))}
                </div>
              </TradingSettingCard>

              <TradingSettingCard icon={<BadgePercent size={17} />} info="Maximum accepted slippage for default orders." title="Default Slippage">
                <select className="trading-select" value={String(defaults.defaultSlippage)} onChange={(event) => updateDefaults({ defaultSlippage: Number(event.target.value) })}>
                  <option value="0.3">0.30%</option>
                  <option value="0.5">0.50%</option>
                  <option value="0.8">0.80%</option>
                  <option value="1">1.00%</option>
                </select>
                <RangeControl maxLabel="5%" minLabel="0%" value={defaults.defaultSlippage} />
              </TradingSettingCard>

              <TradingSettingCard icon={<Target size={17} />} info="How take-profits are prefilled." title="Take-Profit Mode">
                <select className="trading-select" value={defaults.takeProfitMode} onChange={(event) => updateDefaults({ takeProfitMode: event.target.value as UserPreferences['takeProfitMode'] })}>
                  <option value="tp-limit">TP Limit</option>
                  <option value="tp-market">TP Market</option>
                  <option value="scale-out">Scale out</option>
                </select>
              </TradingSettingCard>

              <TradingSettingCard icon={<Shield size={17} />} info="Stop-loss mode required before live execution." title="Stop-Loss Mode">
                <select className="trading-select" value={defaults.stopLossMode} onChange={(event) => updateDefaults({ stopLossMode: event.target.value as UserPreferences['stopLossMode'] })}>
                  <option value="sl-market">SL Market</option>
                  <option value="sl-limit">SL Limit</option>
                </select>
              </TradingSettingCard>

              <TradingSettingCard icon={<Target size={17} />} info="Default multi-target behavior." title="Multi-TP Behavior">
                <select className="trading-select" value={defaults.multiTpBehavior} onChange={(event) => updateDefaults({ multiTpBehavior: event.target.value as UserPreferences['multiTpBehavior'] })}>
                  <option value="single-target">Single target</option>
                  <option value="partial-take-profits">Partial Take Profits</option>
                  <option value="equal-ladder">Equal ladder</option>
                </select>
              </TradingSettingCard>

              <TradingSettingCard icon={<Shield size={17} />} info="Moves stop to break-even after a rule is met." title="Break-Even Automation">
                <div className="setting-inline">
                  <button className={`switch ${defaults.breakEvenAutomation ? 'is-on' : ''}`} aria-label="Break-even automation" onClick={() => updateDefaults({ breakEvenAutomation: !defaults.breakEvenAutomation })} type="button" />
                  <select className="trading-select" value={defaults.breakEvenRule} onChange={(event) => updateDefaults({ breakEvenRule: event.target.value as UserPreferences['breakEvenRule'] })}>
                    <option value="off">Off</option>
                    <option value="move-to-be-at-1r">Move to BE at 1R</option>
                    <option value="move-to-be-at-tp1">Move to BE at TP1</option>
                  </select>
                </div>
              </TradingSettingCard>

              <TradingSettingCard icon={<TrendingUp size={17} />} info="Trailing stop defaults for new positions." title="Trailing Stop Defaults">
                <div className="setting-inline">
                  <button className={`switch ${defaults.trailingStopEnabled ? 'is-on' : ''}`} aria-label="Trailing stop" onClick={() => updateDefaults({ trailingStopEnabled: !defaults.trailingStopEnabled })} type="button" />
                  <select className="trading-select" value={String(defaults.trailingStopTrailAtr)} onChange={(event) => updateDefaults({ trailingStopTrailAtr: Number(event.target.value) })}>
                    <option value="1">1.00 ATR</option>
                    <option value="1.5">1.50 ATR</option>
                    <option value="2">2.00 ATR</option>
                  </select>
                </div>
              </TradingSettingCard>

              <TradingSettingCard icon={<Wallet size={17} />} info="Position sizing method used by the builder." title="Position Sizing Method">
                <select className="trading-select" value={defaults.positionSizingMethod} onChange={(event) => updateDefaults({ positionSizingMethod: event.target.value as UserPreferences['positionSizingMethod'] })}>
                  <option value="risk-percent">Risk % of Equity</option>
                  <option value="fixed-usdt">Fixed USDT</option>
                  <option value="fixed-size">Fixed Size</option>
                </select>
                <label className="compact-input-label">
                  Risk %
                  <input value={`${defaults.defaultRiskPerTrade.toFixed(2)}%`} readOnly />
                </label>
              </TradingSettingCard>

              <TradingSettingCard icon={<Wallet size={17} />} info="Default execution venue. API keys stay server-side." title="Default Account / Exchange">
                <select className="trading-select" value={defaults.defaultExchange} onChange={(event) => updateDefaults({ defaultExchange: event.target.value })}>
                  <option value="Paper">Paper</option>
                  <option value="Binance">Binance</option>
                  <option value="Bybit">Bybit</option>
                  <option value="OKX">OKX</option>
                  <option value="dYdX">dYdX</option>
                  <option value="Hyperliquid">Hyperliquid</option>
                  <option value="1inch">1inch</option>
                </select>
                <select className="trading-select" value={defaults.defaultAccount} onChange={(event) => updateDefaults({ defaultAccount: event.target.value })}>
                  <option value="Main Account">Main Account</option>
                  <option value="Paper Account">Paper Account</option>
                  <option value="Bot Sandbox">Bot Sandbox</option>
                </select>
              </TradingSettingCard>
            </div>

            <Card className="quick-presets-card">
              <div>
                <h2>Quick Presets</h2>
                <p>Load a complete set of defaults.</p>
              </div>
              <div className="quick-presets-row">
                {presets.map((preset) => (
                  <button className={defaults.quickPreset === preset.id ? 'is-active' : undefined} key={preset.id} onClick={() => updateDefaults(preset.values)} type="button">
                    {preset.icon}
                    {preset.label}
                  </button>
                ))}
              </div>
            </Card>
          </div>

          <aside className="order-preview-card" aria-label="Order panel preview">
            <div>
              <h2>Order Panel Preview</h2>
              <p>Defaults in the order panel.</p>
            </div>

            <div className="order-preview-shell">
              <div className="segmented-options order-preview-direction">
                <button className={previewDirection === 'long' ? 'is-active' : undefined} onClick={() => setPreviewDirection('long')} type="button">Long</button>
                <button className={previewDirection === 'short' ? 'is-active' : undefined} onClick={() => setPreviewDirection('short')} type="button">Short</button>
              </div>

              <div className="order-type-tabs">
                {(['limit', 'market', 'stop'] as const).map((type) => (
                  <button className={defaults.orderType === type ? 'is-active' : undefined} key={type} onClick={() => updateDefaults({ orderType: type })} type="button">
                    {orderTypeLabel(type)}
                  </button>
                ))}
              </div>

              <label>
                Price (USDT)
                <span>
                  67,347.60
                  <ChevronDown size={14} />
                </span>
              </label>

              <label>
                Size
                <span>
                  {estimatedSize} BTC
                  <ChevronDown size={14} />
                </span>
              </label>

              <div className="preview-leverage">
                <strong>{defaults.defaultLeverage}x</strong>
                <RangeControl maxLabel="100x" minLabel="1x" value={defaults.defaultLeverage} />
              </div>

              <div className="preview-rule">
                <span>Take Profit</span>
                <button className={`switch ${takeProfitEnabled ? 'is-on' : ''}`} aria-label="Take Profit enabled" onClick={() => setTakeProfitEnabled((current) => !current)} type="button" />
              </div>
              <div className="preview-rule-grid">
                <span>{takeProfitLabel(defaults.takeProfitMode)}</span>
                <span>{defaults.multiTpBehavior === 'partial-take-profits' ? '2 levels' : '1 level'}</span>
              </div>

              <div className="preview-rule">
                <span>Stop Loss</span>
                <button className={`switch ${stopLossEnabled ? 'is-on' : ''}`} aria-label="Stop Loss enabled" onClick={() => setStopLossEnabled((current) => !current)} type="button" />
              </div>
              <div className="preview-rule-grid">
                <span>{stopLossLabel(defaults.stopLossMode)}</span>
                <span>{defaults.breakEvenAutomation ? 'BE at 1R' : 'BE off'}</span>
              </div>

              <div className="preview-flags">
                <span>Break-even</span>
                <button className={`switch ${defaults.breakEvenAutomation ? 'is-on' : ''}`} aria-label="Preview break-even" onClick={() => updateDefaults({ breakEvenAutomation: !defaults.breakEvenAutomation })} type="button" />
                <span>Trailing</span>
                <button className={`switch ${defaults.trailingStopEnabled ? 'is-on' : ''}`} aria-label="Preview trailing stop" onClick={() => updateDefaults({ trailingStopEnabled: !defaults.trailingStopEnabled })} type="button" />
              </div>

              <Button className="execute-button" onClick={() => setPreviewStatus(`${previewDirection === 'long' ? 'Buy' : 'Sell'} preview checked`)} variant="primary">
                {previewDirection === 'long' ? 'Buy' : 'Sell'} BTC/USDT
              </Button>

              <small>{previewStatus} · Est. liq. 60,123.45 USDT</small>
            </div>

            <Card className="defaults-apply-card">
              <strong>Defaults apply to</strong>
              <span>New orders</span>
              <span>Bots & strategies</span>
              <small>{saveStatus}</small>
            </Card>
          </aside>
        </div>
      </div>
    </section>
  );
}

type TradingSettingCardProps = {
  children: ReactNode;
  icon: ReactNode;
  info: string;
  title: string;
};

function TradingSettingCard({ children, icon, info, title }: TradingSettingCardProps) {
  return (
    <Card className="trading-setting-card">
      <div className="trading-setting-card__title">
        {icon}
        <span>{title}</span>
        <InfoButton content={info} label={`${title} info`} />
      </div>
      {children}
    </Card>
  );
}

type RangeControlProps = {
  maxLabel: string;
  minLabel: string;
  value: number;
};

function RangeControl({ maxLabel, minLabel, value }: RangeControlProps) {
  const progress = Math.min(100, Math.max(8, value * 12));

  return (
    <div className="trading-range" style={{ '--range-progress': `${progress}%` } as CSSProperties}>
      <span />
      <div>
        <small>{minLabel}</small>
        <small>{maxLabel}</small>
      </div>
    </div>
  );
}

function marketTypeLabel(type: UserPreferences['preferredMarketType']) {
  return type === 'spot' ? 'Spot' : type === 'perpetual' ? 'Perpetual' : 'Futures';
}

function orderTypeLabel(type: UserPreferences['orderType']) {
  return type === 'limit' ? 'Limit' : type === 'market' ? 'Market' : 'Stop';
}

function takeProfitLabel(mode: UserPreferences['takeProfitMode']) {
  return mode === 'tp-limit' ? 'TP Limit' : mode === 'tp-market' ? 'TP Market' : 'Scale out';
}

function stopLossLabel(mode: UserPreferences['stopLossMode']) {
  return mode === 'sl-market' ? 'SL Market' : 'SL Limit';
}
