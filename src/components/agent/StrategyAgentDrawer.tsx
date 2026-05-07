'use client';

import { Bot, BrainCircuit, CheckCircle2, ClipboardList, FileText, GitCompare, LineChart, Lock, NotebookPen, Play, RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { postJson } from '../../services/api-client';
import type { AgentAction, AgentReport, AgentRun, AgentSettings, AgentSuggestion, StrategyVersion } from '../../types/trading';
import { Button, Modal } from '../ui';

type StrategyAgentDrawerProps = {
  context: 'backtest' | 'bot' | 'chart' | 'journal' | 'strategy';
  reports?: AgentReport[];
  runs?: AgentRun[];
  settings: AgentSettings;
  strategyId?: string;
  strategyName?: string;
  suggestions: AgentSuggestion[];
  versions?: StrategyVersion[];
};

type AgentActionResponse = {
  confirmationRequired?: boolean;
  decision?: {
    blockers: string[];
    requiredConfirmation: boolean;
    warnings: string[];
  };
  result?: unknown;
};

const actionButtons: Array<{ action: AgentAction; icon: typeof BrainCircuit; label: string }> = [
  { action: 'analyze_strategy', icon: BrainCircuit, label: 'Analyze' },
  { action: 'create_variant', icon: GitCompare, label: 'Variant' },
  { action: 'compare_versions', icon: GitCompare, label: 'Compare' },
  { action: 'run_backtest', icon: LineChart, label: 'Backtest' },
  { action: 'run_paper_test', icon: RotateCcw, label: 'Paper' },
  { action: 'create_report', icon: FileText, label: 'Report' },
  { action: 'write_journal_note', icon: NotebookPen, label: 'Journal' },
  { action: 'prepare_bot', icon: Bot, label: 'Bot Draft' },
];

const actionPermission: Partial<Record<AgentAction, keyof AgentSettings['permissions']>> = {
  analyze_strategy: 'analyze_strategy',
  create_report: 'create_report',
  create_variant: 'create_variant',
  prepare_bot: 'prepare_bot',
  run_backtest: 'run_backtest',
  run_paper_test: 'run_paper_test',
  write_journal_note: 'write_journal_note',
};

export function StrategyAgentDrawer({ context, reports = [], runs = [], settings, strategyId, strategyName = 'Strategy', suggestions, versions = [] }: StrategyAgentDrawerProps) {
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');
  const [pendingAction, setPendingAction] = useState<AgentAction | null>(null);
  const latestRun = runs[0];
  const latestReport = reports[0];
  const latestVersion = versions[0];
  const visibleSuggestions = suggestions.slice(0, 3);
  const availableActions = useMemo(
    () =>
      actionButtons.map((item) => {
        const permission = actionPermission[item.action];
        const allowed = !permission || settings.permissions[permission];

        return { ...item, allowed };
      }),
    [settings.permissions],
  );

  async function runAction(action: AgentAction, confirmed = false) {
    setStatus(confirmed ? 'Running confirmed action' : 'Checking guards');

    try {
      const response = await postJson<AgentActionResponse>('/api/agent/actions', {
        action,
        confirmed,
        strategyId,
        versionId: latestVersion?.id,
      });

      if (response.confirmationRequired) {
        setPendingAction(action);
        setStatus('Confirmation required');
        return;
      }

      setPendingAction(null);
      setStatus(response.decision?.warnings[0] ?? 'Done');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Action failed');
    }
  }

  return (
    <>
      <Button className="agent-trigger-button" icon={<BrainCircuit size={15} />} onClick={() => setOpen(true)} size="sm" variant="ghost">
        Agent
      </Button>

      {open ? (
        <aside aria-label="Strategy Agent drawer" className="strategy-agent-drawer">
          <header>
            <div>
              <span>{context}</span>
              <h2>Strategy Agent</h2>
            </div>
            <button aria-label="Close Agent" onClick={() => setOpen(false)} type="button">
              <X size={17} />
            </button>
          </header>

          <div className="agent-drawer-status">
            <strong>{settings.mode.replace('_', ' ')}</strong>
            <span>{status}</span>
          </div>

          <div className="agent-mini-summary">
            <div>
              <span>Linked</span>
              <strong>{strategyName}</strong>
            </div>
            <div>
              <span>Version</span>
              <strong>{latestVersion?.version ?? 'none'}</strong>
            </div>
            <div>
              <span>Score</span>
              <strong>{latestVersion ? `${latestVersion.robustnessScore}/100` : '-'}</strong>
            </div>
          </div>

          <section className="agent-drawer-section">
            <h3>Suggestions</h3>
            {visibleSuggestions.length ? (
              visibleSuggestions.map((suggestion) => (
                <article className="agent-suggestion-row" key={suggestion.id}>
                  <div>
                    <strong>{suggestion.title}</strong>
                    <span>{suggestion.reason}</span>
                  </div>
                  <button onClick={() => setDetailsOpen(detailsOpen === suggestion.id ? null : suggestion.id)} type="button">
                    Details
                  </button>
                  {detailsOpen === suggestion.id ? (
                    <ul>
                      {suggestion.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="agent-empty-line">No suggestion yet.</div>
            )}
          </section>

          <section className="agent-drawer-section">
            <h3>Actions</h3>
            <div className="agent-action-grid">
              {availableActions.map((item) => {
                const Icon = item.icon;

                return (
                  <button disabled={!item.allowed} key={item.action} onClick={() => void runAction(item.action)} type="button">
                    {item.allowed ? <Icon size={15} /> : <Lock size={15} />}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="agent-drawer-section">
            <h3>Latest</h3>
            <div className="agent-latest-list">
              <span>
                <CheckCircle2 size={14} />
                {latestRun?.notes ?? 'No run yet'}
              </span>
              <span>
                <ClipboardList size={14} />
                {latestReport?.status.replace('_', ' ') ?? 'No report'}
              </span>
              <span>
                <Play size={14} />
                Live actions blocked
              </span>
            </div>
          </section>
        </aside>
      ) : null}

      <Modal onClose={() => setPendingAction(null)} open={pendingAction !== null} title="Confirm Agent Action">
        <div className="confirmation-modal-body">
          <p>{pendingAction ? `${formatAction(pendingAction)} requires confirmation and Risk Engine checks.` : 'Confirm action.'}</p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => pendingAction && void runAction(pendingAction, true)}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function formatAction(action: AgentAction) {
  return action.replace(/_/g, ' ');
}
