'use client';

import { AlertTriangle, CalendarClock, LockKeyhole, PauseCircle, Save, ShieldCheck, TrendingDown, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Button, Card, ErrorState, HelpPopover, Modal, Toggle } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { RiskRules } from '../../types/trading';

type RiskRulesSettingsPageProps = {
  riskRules: RiskRules;
};

const tradingDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function RiskRulesSettingsPage({ riskRules }: RiskRulesSettingsPageProps) {
  const [rules, setRules] = useState(riskRules);
  const [sessionStart, setSessionStart] = useState('00:00');
  const [sessionEnd, setSessionEnd] = useState('23:59');
  const [activeDays, setActiveDays] = useState(tradingDays);
  const [saveStatus, setSaveStatus] = useState('Ready');
  const [blockOrderModalOpen, setBlockOrderModalOpen] = useState(false);
  const [killSwitchConfirmationOpen, setKillSwitchConfirmationOpen] = useState(false);

  function updateRule(update: Partial<RiskRules>) {
    setRules((currentRules) => ({ ...currentRules, ...update }));
  }

  function toggleDay(day: string) {
    setActiveDays((currentDays) => (currentDays.includes(day) ? currentDays.filter((item) => item !== day) : [...currentDays, day]));
  }

  async function saveRules() {
    setSaveStatus('Saving');

    try {
      const savedRules = await patchJson<RiskRules>('/api/risk-rules', rules);
      setRules(savedRules);
      setSaveStatus('Saved');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  async function confirmKillSwitch() {
    const nextRules = { ...rules, emergencyKillSwitch: !rules.emergencyKillSwitch };

    setRules(nextRules);
    setKillSwitchConfirmationOpen(false);

    try {
      const savedRules = await patchJson<RiskRules>('/api/risk-rules', nextRules);
      setRules(savedRules);
      setSaveStatus('Saved');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return (
    <section className="risk-rules-settings-page" aria-label="Risk rules settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Risk Rules</h1>
          <p>Protect manual trades, strategies and bots with global limits.</p>
        </div>
        <div className="workspace-header__right">
          <Button icon={<AlertTriangle size={15} />} onClick={() => setBlockOrderModalOpen(true)} size="sm" variant="ghost">
            Block Order Test
          </Button>
          <Button icon={<Save size={15} />} onClick={saveRules} size="sm" variant="primary">
            Save Rules
          </Button>
          <HelpPopover items={['Rules apply to manual trades, bots and order checks.', 'Emergency actions require confirmation.']} title="Risk Rules" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="risk-rules" />

        <div className="risk-rules-layout">
          <Card className="risk-rules-main-card">
            <div className="risk-rules-title">
              <ShieldCheck size={24} />
              <div>
                <h2>Risk Rules</h2>
                <p>Global controls for strategies, bots and manual trades.</p>
              </div>
            </div>

            <div className="risk-rules-grid">
              <RuleInput
                icon={<ShieldCheck size={18} />}
                label="Maximum Risk Per Trade"
                onChange={(value) => updateRule({ maxRiskPerTrade: value })}
                suffix="%"
                value={rules.maxRiskPerTrade}
              />
              <SessionHours activeDays={activeDays} end={sessionEnd} onDayToggle={toggleDay} onEndChange={setSessionEnd} onStartChange={setSessionStart} start={sessionStart} />
              <RuleInput icon={<TrendingDown size={18} />} label="Daily Loss Limit" onChange={(value) => updateRule({ dailyLossLimit: value })} suffix="%" value={rules.dailyLossLimit} />
              <RuleInput icon={<PauseCircle size={18} />} label="Bot Pause After Loss Streak" onChange={(value) => updateRule({ botLossStreakPause: value })} suffix="Losses" value={rules.botLossStreakPause} />
              <RuleInput icon={<TrendingDown size={18} />} label="Weekly Loss Limit" onChange={(value) => updateRule({ weeklyLossLimit: value })} suffix="%" value={rules.weeklyLossLimit} />
              <EmergencyRule active={rules.emergencyKillSwitch} onToggle={() => setKillSwitchConfirmationOpen(true)} />
              <RuleInput icon={<Zap size={18} />} label="Maximum Leverage" onChange={(value) => updateRule({ maxLeverage: value })} suffix="x" value={rules.maxLeverage} />
              <AccountProtection rules={rules} updateRule={updateRule} />
              <RuleToggle checked={rules.blockOrdersWithoutStop} icon={<LockKeyhole size={18} />} label="Block Live Orders Without Stop-Loss" onToggle={() => updateRule({ blockOrdersWithoutStop: !rules.blockOrdersWithoutStop })} />
              <RuleInput icon={<ShieldCheck size={18} />} label="Minimum Balance" onChange={(value) => updateRule({ minimumBalance: value })} suffix="USDT" value={rules.minimumBalance} />
              <RuleInput icon={<TrendingDown size={18} />} label="Stop Bots At Max Drawdown" onChange={(value) => updateRule({ stopBotsAtDrawdown: value })} suffix="%" value={rules.stopBotsAtDrawdown} />
              <RuleToggle checked={rules.confirmLiveOrders} icon={<ShieldCheck size={18} />} label="Confirm Before Real Orders" onToggle={() => updateRule({ confirmLiveOrders: !rules.confirmLiveOrders })} />
            </div>
          </Card>

          <Card className="risk-protection-summary-card">
            <h2>Risk Protection Summary</h2>
            <div className="risk-summary-status">
              <ShieldCheck size={32} />
              <div>
                <strong className={rules.emergencyKillSwitch ? 'negative' : 'positive'}>{rules.emergencyKillSwitch ? 'Locked' : 'Active'}</strong>
                <span>{rules.emergencyKillSwitch ? 'Emergency stop enabled' : 'All systems protected'}</span>
              </div>
            </div>
            <div className="risk-summary-list">
              <SummaryLine label="Max Risk Per Trade" value={`${rules.maxRiskPerTrade}%`} />
              <SummaryLine label="Daily Loss Limit" value={`${rules.dailyLossLimit}%`} />
              <SummaryLine label="Weekly Loss Limit" value={`${rules.weeklyLossLimit}%`} />
              <SummaryLine label="Max Leverage" value={`${rules.maxLeverage}x`} />
              <SummaryLine label="Trading Session" value={`${sessionStart} - ${sessionEnd}`} />
              <SummaryLine label="Loss Streak Pause" value={`${rules.botLossStreakPause} losses`} />
              <SummaryLine label="Block Orders Without SL" value={rules.blockOrdersWithoutStop ? 'Enabled' : 'Disabled'} />
              <SummaryLine label="Confirm Real Orders" value={rules.confirmLiveOrders ? 'Enabled' : 'Disabled'} />
              <SummaryLine label="Minimum Balance" value={`${rules.minimumBalance} USDT`} />
            </div>
            <Button icon={<Save size={15} />} onClick={saveRules} variant="primary">
              Save Rules
            </Button>
            <small>{saveStatus}</small>
          </Card>
        </div>
      </div>

      <Modal onClose={() => setKillSwitchConfirmationOpen(false)} open={killSwitchConfirmationOpen} title="Emergency Kill Switch">
        <div className="confirmation-modal-body">
          <p>{rules.emergencyKillSwitch ? 'Disable the emergency stop and allow protected trading again.' : 'Enable emergency stop and block live trading actions.'}</p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setKillSwitchConfirmationOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={confirmKillSwitch}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setBlockOrderModalOpen(false)} open={blockOrderModalOpen} title="Order Blocked">
        <ErrorState
          cancelLabel="Close"
          description="Risk engine blocks this live order before execution."
          details={[
            { label: 'Rule', tone: 'negative', value: 'Stop-loss required' },
            { label: 'Max risk', value: `${rules.maxRiskPerTrade}%` },
            { label: 'Action', value: 'Add stop-loss or reduce size' },
          ]}
          onCancel={() => setBlockOrderModalOpen(false)}
          secondaryActionHref="/charts"
          secondaryActionLabel="Open Chart"
          title="Order blocked by Risk Rules"
        />
      </Modal>
    </section>
  );
}

function RuleInput({ icon, label, onChange, suffix, value }: { icon: ReactNode; label: string; onChange: (value: number) => void; suffix: string; value: number }) {
  return (
    <div className="risk-rule-card">
      <span>{icon}</span>
      <div>
        <strong>{label}</strong>
      </div>
      <label>
        <input onChange={(event) => onChange(Number(event.target.value))} type="number" value={value} />
        <small>{suffix}</small>
      </label>
    </div>
  );
}

function RuleToggle({ checked, icon, label, onToggle }: { checked: boolean; icon: ReactNode; label: string; onToggle: () => void }) {
  return (
    <div className="risk-rule-card risk-rule-card--toggle">
      <span>{icon}</span>
      <div>
        <strong>{label}</strong>
      </div>
      <Toggle checked={checked} label={checked ? 'On' : 'Off'} onClick={onToggle} />
    </div>
  );
}

function SessionHours({
  activeDays,
  end,
  onDayToggle,
  onEndChange,
  onStartChange,
  start,
}: {
  activeDays: string[];
  end: string;
  onDayToggle: (day: string) => void;
  onEndChange: (value: string) => void;
  onStartChange: (value: string) => void;
  start: string;
}) {
  return (
    <div className="risk-rule-card risk-rule-card--session">
      <span>
        <CalendarClock size={18} />
      </span>
      <div>
        <strong>Allowed Trading Session Hours</strong>
      </div>
      <div className="session-controls">
        <input aria-label="Start Time" onChange={(event) => onStartChange(event.target.value)} type="time" value={start} />
        <input aria-label="End Time" onChange={(event) => onEndChange(event.target.value)} type="time" value={end} />
        <div>
          {tradingDays.map((day) => (
            <button className={activeDays.includes(day) ? 'is-active' : undefined} key={day} onClick={() => onDayToggle(day)} type="button">
              {day}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmergencyRule({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <div className="risk-rule-card risk-rule-card--emergency">
      <span>
        <AlertTriangle size={18} />
      </span>
      <div>
        <strong>Emergency Kill Switch</strong>
      </div>
      <Button onClick={onToggle} size="sm" variant={active ? 'ghost' : 'danger'}>
        {active ? 'Disable' : 'Enable'}
      </Button>
    </div>
  );
}

function AccountProtection({ rules, updateRule }: { rules: RiskRules; updateRule: (update: Partial<RiskRules>) => void }) {
  return (
    <div className="risk-rule-card risk-rule-card--protection">
      <span>
        <ShieldCheck size={18} />
      </span>
      <div>
        <strong>Account Protection Rules</strong>
      </div>
      <div className="protection-checks">
        <Toggle checked={rules.cancelOnDisconnect} label="Cancel on disconnect" onClick={() => updateRule({ cancelOnDisconnect: !rules.cancelOnDisconnect })} />
        <Toggle checked={rules.minimumBalance > 0} label="Balance floor" onClick={() => updateRule({ minimumBalance: rules.minimumBalance > 0 ? 0 : 1000 })} />
      </div>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
