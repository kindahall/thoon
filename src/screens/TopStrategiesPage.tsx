import { ArrowRight, CheckCircle2, LineChart, Trophy } from 'lucide-react';
import Link from 'next/link';

import { Badge, Card, EmptyState } from '../components/ui';
import type { EndorsedStrategy } from '../utils/strategy-endorsement';
import { formatUsd } from '../utils/format';

type TopStrategiesPageProps = {
  endorsedStrategies: EndorsedStrategy[];
};

export function TopStrategiesPage({ endorsedStrategies }: TopStrategiesPageProps) {
  const leader = endorsedStrategies[0];

  return (
    <section className="top-strategies-page" aria-label="Most validated strategies">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Top Strategies</h1>
          <p>Backtest verified, paper-positive and ready for close monitoring.</p>
        </div>
        <div className="workspace-header__right">
          <Badge tone={endorsedStrategies.length ? 'negative' : 'neutral'}>{endorsedStrategies.length} fiables</Badge>
          <Link className="ui-button ui-button--ghost ui-button--sm" href="/agent">
            Agent
          </Link>
        </div>
      </div>

      {leader ? (
        <Card className="top-strategy-hero strategy-trusted-pulse">
          <div>
            <span>
              <Trophy size={20} />
              Best reliable candidate
            </span>
            <h2>{leader.strategy.name}</h2>
            <p>{leader.strategy.market} · {leader.strategy.timeframe} · score {leader.score}/100</p>
          </div>
          <div className="top-strategy-hero__stats">
            <Metric label="Backtest PnL" value={formatUsd(leader.report.netProfit)} />
            <Metric label="Profit Factor" value={`${leader.report.profitFactor.toFixed(2)} PF`} />
            <Metric label="Paper R" value={`${leader.paperSession.rMultiple.toFixed(2)}R`} />
          </div>
          <Link className="ui-button ui-button--primary ui-button--sm" href={`/strategies/${leader.strategy.id}`}>
            Open
            <ArrowRight size={15} />
          </Link>
        </Card>
      ) : (
        <EmptyState
          actionHref="/agent"
          actionLabel="Ask Thoonix"
          description="A strategy appears here only after a verified calculated backtest and a positive paper session."
          icon={<Trophy size={22} />}
          secondaryActionHref="/backtest"
          secondaryActionLabel="Run Backtest"
          title="No reliable strategy yet"
        />
      )}

      <div className="top-strategy-grid">
        {endorsedStrategies.map((item, index) => (
          <Card className="top-strategy-card strategy-trusted-pulse" key={`${item.strategy.id}:${item.report.id}:${item.paperSession.id}`}>
            <div className="top-strategy-card__head">
              <span>#{index + 1}</span>
              <Badge tone="negative">fiable</Badge>
            </div>
            <h2>{item.strategy.name}</h2>
            <div className="top-strategy-card__meta">
              <span>{item.report.market ?? item.strategy.market}</span>
              <span>{item.report.timeframe ?? item.strategy.timeframe}</span>
              <span>{item.report.period}</span>
            </div>
            <div className="top-strategy-card__score">
              <strong>{item.score}/100</strong>
              <span>Validated score</span>
            </div>
            <div className="top-strategy-metrics">
              <Metric label="PnL" value={formatUsd(item.report.netProfit)} />
              <Metric label="WR" value={`${item.report.winRate.toFixed(1)}%`} />
              <Metric label="DD" value={`${item.report.drawdown.toFixed(1)}%`} />
              <Metric label="Paper" value={`${item.paperSession.rMultiple.toFixed(2)}R`} />
            </div>
            <div className="top-strategy-reasons">
              {item.reasons.slice(0, 3).map((reason) => (
                <span key={reason}>
                  <CheckCircle2 size={14} />
                  {reason}
                </span>
              ))}
            </div>
            <div className="top-strategy-actions">
              <Link href={`/backtest?strategyId=${encodeURIComponent(item.strategy.id)}&reportId=${encodeURIComponent(item.report.id)}`}>
                <LineChart size={15} />
                Backtest
              </Link>
              <Link href={`/strategies/${item.strategy.id}`}>
                Details
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
