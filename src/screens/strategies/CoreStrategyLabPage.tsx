import { Archive, Bot, BrainCircuit, GitCompare, LineChart, Lock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Card } from '../../components/ui';
import { JIMMY_STRATEGY_ID } from '../../config/jimmy-strategy';
import type { AgentReport, AgentRun, AgentSettings, AgentSuggestion, BacktestReport, Strategy, StrategyVersion } from '../../types/trading';
import { formatUsd } from '../../utils/format';

type CoreStrategyLabPageProps = {
  reports: AgentReport[];
  runs: AgentRun[];
  settings: AgentSettings;
  strategies: Strategy[];
  suggestions: AgentSuggestion[];
  backtests: BacktestReport[];
  versions: StrategyVersion[];
};

export function CoreStrategyLabPage({ backtests, reports, runs, settings, strategies, suggestions, versions }: CoreStrategyLabPageProps) {
  const coreVersion = versions.find((version) => version.protectedOriginal && version.strategyId === JIMMY_STRATEGY_ID) ?? versions.find((version) => version.protectedOriginal) ?? versions[0];
  const coreStrategy = strategies.find((strategy) => strategy.id === coreVersion?.strategyId) ?? strategies[0];
  const coreVersions = versions.filter((version) => version.strategyId === coreStrategy?.id);
  const activeVariants = coreVersions.filter((version) => version.status === 'draft' || version.status === 'testing');
  const rejectedVariants = coreVersions.filter((version) => version.status === 'archived' || version.status === 'rejected');
  const paperVariants = coreVersions.filter((version) => version.status === 'paper');
  const candidateVariants = coreVersions.filter((version) => version.status === 'candidate' || version.status === 'live-ready');
  const latestBacktest = backtests.find((report) => report.strategyId === coreStrategy?.id);

  return (
    <section className="core-strategy-lab-page" aria-label="Jimmy Strategy Lab">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Jimmy Strategy Lab</h1>
          <p>jimmy protected source, adaptive parameters and validation pipeline.</p>
        </div>
        <div className="workspace-header__right">
          <Badge tone="positive">Original Protected</Badge>
          <Link className="ui-button ui-button--secondary ui-button--sm" href={`/backtest?strategyId=${encodeURIComponent(coreStrategy?.id ?? '')}`}>
            <span className="ui-button__icon">
              <LineChart size={15} />
            </span>
            Backtest
          </Link>
          <StrategyAgentDrawer context="strategy" reports={reports} runs={runs} settings={settings} strategyId={coreStrategy?.id} strategyName={coreStrategy?.name} suggestions={suggestions.filter((suggestion) => suggestion.strategyId === coreStrategy?.id)} versions={coreVersions} />
        </div>
      </div>

      <div className="core-lab-grid">
        <Card className="core-lab-original">
          <div className="agent-card-head">
            <ShieldCheck size={18} />
            <div>
              <h2>{coreStrategy?.name ?? 'Core Strategy'}</h2>
              <span>{coreStrategy?.market} · {coreStrategy?.timeframe}</span>
            </div>
          </div>
          <div className="core-lab-original__metrics">
            <CoreMetric label="Version" value={coreVersion?.version ?? 'Source'} />
            <CoreMetric label="Robustness" value={coreVersion ? `${coreVersion.robustnessScore}/100` : '-'} />
            <CoreMetric label="Backtest" value={latestBacktest ? formatUsd(latestBacktest.netProfit) : 'None'} />
            <CoreMetric label="Stage" value={coreVersion?.stage.replace(/_/g, ' ') ?? 'not validated'} />
          </div>
          <div className="core-protection-strip">
            <Lock size={15} />
            <span>Original cannot be edited, archived or replaced by the agent.</span>
          </div>
        </Card>

        <Card className="core-lab-pipeline">
          <div className="agent-card-head">
            <BrainCircuit size={18} />
            <div>
              <h2>Validation Pipeline</h2>
              <span>Draft → Backtested → Paper → Candidate → Bot Draft → Live-ready</span>
            </div>
          </div>
          <div className="validation-pipeline-row">
            {['draft', 'backtested', 'paper_tested', 'candidate', 'bot_draft', 'live_ready'].map((stage) => (
              <span className={coreVersions.some((version) => version.stage === stage) ? 'is-active' : undefined} key={stage}>
                {stage.replace('_', ' ')}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <div className="core-lab-sections">
        <VersionSection icon={<GitCompare size={18} />} title="Active Variants" versions={activeVariants} />
        <VersionSection icon={<RotateIcon />} title="Paper" versions={paperVariants} />
        <VersionSection icon={<Bot size={18} />} title="Candidates" versions={candidateVariants} />
        <VersionSection icon={<Archive size={18} />} title="Archived / Rejected" versions={rejectedVariants} />
      </div>
    </section>
  );
}

function VersionSection({ icon, title, versions }: { icon: ReactNode; title: string; versions: StrategyVersion[] }) {
  return (
    <Card className="core-lab-version-card">
      <div className="agent-card-head">
        {icon}
        <div>
          <h2>{title}</h2>
          <span>{versions.length} versions</span>
        </div>
      </div>
      <div className="core-version-list">
        {versions.length ? (
          versions.map((version) => (
            <div key={version.id}>
              <strong>{version.version}</strong>
              <span>{version.changeSummary}</span>
              <Badge tone={version.robustnessScore >= 70 ? 'positive' : version.robustnessScore >= 50 ? 'warning' : 'negative'}>{version.robustnessScore}</Badge>
              <small>{version.stage.replace(/_/g, ' ')}</small>
            </div>
          ))
        ) : (
          <div className="agent-empty-line">No version in this lane.</div>
        )}
      </div>
    </Card>
  );
}

function CoreMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RotateIcon() {
  return <LineChart size={18} />;
}
