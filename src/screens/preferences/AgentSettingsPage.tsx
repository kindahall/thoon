'use client';

import { Bot, BrainCircuit, CheckCircle2, Lock, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { AgentAction, AgentPermission, AgentSettings, StrategyAgentMode } from '../../types/trading';

type AgentSettingsPageProps = {
  aiStatus: {
    configured: boolean;
    endpoint: string;
    model: string;
    provider: string;
    sandbox?: string;
    status?: string;
  };
  settings: AgentSettings;
};

const modeOptions: Array<{ label: string; value: StrategyAgentMode }> = [
  { label: 'Manual', value: 'manual' },
  { label: 'Assisted', value: 'assisted' },
  { label: 'Limited', value: 'limited_autonomous' },
  { label: 'Guarded', value: 'guarded_autonomous' },
];

const visiblePermissions: Array<{ label: string; key: AgentPermission }> = [
  { key: 'analyze_strategy', label: 'Analyze' },
  { key: 'create_variant', label: 'Variant' },
  { key: 'run_backtest', label: 'Backtest' },
  { key: 'run_paper_test', label: 'Paper' },
  { key: 'create_report', label: 'Report' },
  { key: 'prepare_bot', label: 'Prepare Bot' },
  { key: 'edit_variant', label: 'Edit Variant' },
  { key: 'archive_variant', label: 'Archive Variant' },
  { key: 'write_journal_note', label: 'Journal Note' },
];

const blockedPermissions: Array<{ label: string; key: AgentPermission }> = [
  { key: 'launch_live_bot', label: 'Live bot' },
  { key: 'execute_live_trade', label: 'Live trade' },
  { key: 'edit_original_strategy', label: 'Edit original' },
  { key: 'modify_risk_rules', label: 'Risk rules' },
  { key: 'modify_api_keys', label: 'API keys' },
  { key: 'delete_strategy', label: 'Delete strategy' },
];

const askActions: Array<{ label: string; key: AgentAction }> = [
  { key: 'create_variant', label: 'Create variant' },
  { key: 'run_backtest', label: 'Run backtest' },
  { key: 'run_paper_test', label: 'Paper test' },
  { key: 'prepare_bot', label: 'Prepare bot' },
  { key: 'archive_variant', label: 'Archive version' },
];

export function AgentSettingsPage({ aiStatus, settings }: AgentSettingsPageProps) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState('Ready');
  const draftRef = useRef(settings);

  function updateLimit<K extends keyof AgentSettings['limits']>(key: K, value: AgentSettings['limits'][K]) {
    const nextDraft = { ...draftRef.current, limits: { ...draftRef.current.limits, [key]: value } };

    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setStatus('Unsaved changes');
  }

  function updateInstruction<K extends keyof AgentSettings['instructions']>(key: K, value: string) {
    const nextDraft = { ...draftRef.current, instructions: { ...draftRef.current.instructions, [key]: value } };

    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setStatus('Unsaved changes');
  }

  function togglePermission(key: AgentPermission) {
    if (blockedPermissions.some((permission) => permission.key === key)) {
      return;
    }

    commitDraft((current) => ({ ...current, permissions: { ...current.permissions, [key]: !current.permissions[key] } }), 'Permission saved');
  }

  async function persist(nextDraft: AgentSettings, successMessage = 'Saved') {
    setStatus('Saving');

    try {
      const nextSettings = await patchJson<AgentSettings>('/api/agent/settings', nextDraft);
      draftRef.current = nextSettings;
      setDraft(nextSettings);
      setStatus(successMessage);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  function commitDraft(update: (current: AgentSettings) => AgentSettings, successMessage: string) {
    const next = update(draftRef.current);

    draftRef.current = next;
    setDraft(next);
    void persist(next, successMessage);
  }

  async function save() {
    await persist(draftRef.current);
  }

  const providerStatusLabel = aiStatus.provider === 'codex' ? (aiStatus.configured ? 'forfait connecte' : 'Codex non connecte') : aiStatus.configured ? 'configured' : 'missing key';

  return (
    <section className="agent-settings-page" aria-label="Strategy Agent preferences">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Strategy Agent</h1>
          <p>Autonomy, permissions and safe validation scope.</p>
        </div>
        <div className="workspace-header__right">
          <Badge tone={draft.enabled ? 'positive' : 'neutral'}>{draft.enabled ? 'Enabled' : 'Disabled'}</Badge>
          <Button icon={<Save size={15} />} onClick={save} size="sm" variant="primary">
            Save
          </Button>
          <HelpPopover items={['Live actions are never automatic.', 'Risk Engine remains the final gate.', 'Original versions stay protected.']} title="Strategy Agent" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="agent" />

        <div className="agent-settings-grid">
          <Card className="agent-settings-card">
            <div className="agent-card-head">
              <BrainCircuit size={18} />
              <div>
                <h2>Autonomy</h2>
                <span>{status}</span>
              </div>
            </div>
            <div className="agent-mode-row" aria-label="Strategy Agent mode">
              {modeOptions.map((mode) => (
                <button className={draft.mode === mode.value ? 'is-active' : undefined} key={mode.value} onClick={() => commitDraft((current) => ({ ...current, mode: mode.value }), `${mode.label} saved`)} type="button">
                  {mode.label}
                </button>
              ))}
            </div>
            <label className="agent-toggle-line">
              <input checked={draft.enabled} onChange={(event) => commitDraft((current) => ({ ...current, enabled: event.target.checked }), event.target.checked ? 'Agent enabled' : 'Agent suspended')} type="checkbox" />
              <span>Agent enabled</span>
              <strong>{draft.mode.replace('_', ' ')}</strong>
            </label>
            <div className="agent-never-row">
              <span>AI provider</span>
              <strong>{aiStatus.provider} · {aiStatus.model}</strong>
            </div>
            <div className="agent-never-row">
              <span>Endpoint</span>
              <strong>{aiStatus.endpoint} · {providerStatusLabel}</strong>
            </div>
            {aiStatus.provider === 'codex' ? (
              <div className="agent-never-row">
                <span>Codex sandbox</span>
                <strong>{aiStatus.sandbox ?? 'read-only'}</strong>
              </div>
            ) : null}
          </Card>

          <Card className="agent-settings-card">
            <div className="agent-card-head">
              <ShieldCheck size={18} />
              <div>
                <h2>Permissions</h2>
                <span>Safe by default</span>
              </div>
            </div>
            <div className="agent-permission-grid">
              {visiblePermissions.map((permission) => (
                <button className={draft.permissions[permission.key] ? 'is-active' : undefined} key={permission.key} onClick={() => togglePermission(permission.key)} type="button">
                  <CheckCircle2 size={14} />
                  {permission.label}
                </button>
              ))}
            </div>
            <div className="agent-blocked-grid">
              {blockedPermissions.map((permission) => (
                <span key={permission.key}>
                  <Lock size={13} />
                  {permission.label}
                </span>
              ))}
            </div>
          </Card>

          <Card className="agent-settings-card">
            <div className="agent-card-head">
              <SlidersHorizontal size={18} />
              <div>
                <h2>Limits</h2>
                <span>Validation scope</span>
              </div>
            </div>
            <div className="agent-limits-grid">
              <AgentInput label="Markets" value={draft.limits.allowedMarkets.join(', ')} onChange={(value) => updateLimit('allowedMarkets', splitCsv(value))} />
              <AgentInput label="Timeframes" value={draft.limits.allowedTimeframes.join(', ')} onChange={(value) => updateLimit('allowedTimeframes', splitCsv(value) as AgentSettings['limits']['allowedTimeframes'])} />
              <AgentNumber label="Max variants/day" value={draft.limits.maxVariantsPerDay} onChange={(value) => updateLimit('maxVariantsPerDay', value)} />
              <AgentNumber label="Max backtests/day" value={draft.limits.maxBacktestsPerDay} onChange={(value) => updateLimit('maxBacktestsPerDay', value)} />
              <AgentNumber label="Min paper days" value={draft.limits.minPaperDays} onChange={(value) => updateLimit('minPaperDays', value)} />
              <AgentNumber label="Max drawdown %" value={draft.limits.maxDrawdownCandidate} onChange={(value) => updateLimit('maxDrawdownCandidate', value)} />
              <AgentNumber label="Profit factor min" value={draft.limits.minProfitFactor} onChange={(value) => updateLimit('minProfitFactor', value)} step={0.05} />
              <AgentNumber label="Min trades" value={draft.limits.minTrades} onChange={(value) => updateLimit('minTrades', value)} />
            </div>
          </Card>

          <Card className="agent-settings-card">
            <div className="agent-card-head">
              <Bot size={18} />
              <div>
                <h2>Ask / Auto</h2>
                <span>Confirm sensitive steps</span>
              </div>
            </div>
            <div className="agent-ask-grid">
              {askActions.map((action) => (
                <label key={action.key}>
                  <input checked={Boolean(draft.askBefore[action.key])} onChange={(event) => commitDraft((current) => ({ ...current, askBefore: { ...current.askBefore, [action.key]: event.target.checked } }), `${action.label} rule saved`)} type="checkbox" />
                  <span>{action.label}</span>
                </label>
              ))}
            </div>
            <div className="agent-never-row">
              <span>Never auto</span>
              <strong>Live · API · Risk Rules · Delete</strong>
            </div>
          </Card>

          <Card className="agent-settings-card agent-settings-card--wide">
            <div className="agent-card-head">
              <BrainCircuit size={18} />
              <div>
                <h2>Instruction Store</h2>
                <span>Used by suggestions, not by Risk Engine</span>
              </div>
            </div>
            <div className="agent-instruction-grid">
              <AgentTextArea label="General" value={draft.instructions.general} onChange={(value) => updateInstruction('general', value)} />
              <AgentTextArea label="Core strategy" value={draft.instructions.mainStrategy} onChange={(value) => updateInstruction('mainStrategy', value)} />
              <AgentTextArea label="Forbidden" value={draft.instructions.forbiddenParameters} onChange={(value) => updateInstruction('forbiddenParameters', value)} />
              <AgentTextArea label="Promotion" value={draft.instructions.promotionRules} onChange={(value) => updateInstruction('promotionRules', value)} />
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function AgentInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label>
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function AgentNumber({ label, onChange, step = 1, value }: { label: string; onChange: (value: number) => void; step?: number; value: number }) {
  return (
    <label>
      <span>{label}</span>
      <input onChange={(event) => onChange(Number(event.target.value))} step={step} type="number" value={value} />
    </label>
  );
}

function AgentTextArea({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label>
      <span>{label}</span>
      <textarea onChange={(event) => onChange(event.target.value)} rows={3} value={value} />
    </label>
  );
}

function splitCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
