import type { AgentSuggestion, BacktestReport, RiskRules, Strategy, StrategyVersion } from '../types/trading';
import { getThoonServerEnv } from './env';

type AgentAiContext = {
  backtests: BacktestReport[];
  riskRules: RiskRules;
  strategy?: Strategy;
  versions: StrategyVersion[];
};

type AgentAiSuggestionDraft = {
  action?: string;
  confidence?: number;
  impact?: string;
  reason?: string;
  risk?: 'high' | 'low' | 'medium';
  title?: string;
};

type AgentAiPayload = {
  suggestions?: AgentAiSuggestionDraft[];
  summary?: string[];
};

export function getStrategyAgentAiStatus() {
  const env = getThoonServerEnv();

  return {
    configured: env.agentAiProvider === 'codex' || env.agentAiProvider === 'local' || Boolean(env.agentAiApiKey),
    endpoint: env.agentAiProvider === 'codex' ? 'server-side-codex' : env.agentAiEndpoint,
    model: env.agentAiProvider === 'codex' ? 'codex-research' : env.agentAiProvider === 'local' ? 'local-rules' : env.agentAiModel,
    provider: env.agentAiProvider,
  };
}

export async function generateAiStrategySuggestions(context: AgentAiContext): Promise<{ provider: ReturnType<typeof getStrategyAgentAiStatus>; suggestions: AgentSuggestion[]; summary: string[] } | undefined> {
  const env = getThoonServerEnv();

  if (env.agentAiProvider === 'codex') {
    return callCodexProvider(context);
  }

  if (env.agentAiProvider === 'local') {
    return undefined;
  }

  if (!env.agentAiApiKey) {
    throw new Error('Strategy Agent AI provider is enabled but no API key is configured.');
  }

  if (env.agentAiEndpoint === 'chat-completions') {
    return callChatCompatibleProvider(context);
  }

  return callResponsesProvider(context);
}

function callCodexProvider(context: AgentAiContext) {
  const strategyId = context.strategy?.id ?? context.versions[0]?.strategyId ?? 'strategy';
  const versionId = context.versions.find((version) => version.strategyId === strategyId)?.id ?? context.versions[0]?.id;
  const latestBacktest = context.backtests.find((report) => report.strategyId === strategyId);
  const latestVersion = context.versions.find((version) => version.strategyId === strategyId);
  const protectedCore = Boolean(context.strategy?.agentSource?.protectedCore);
  const now = new Date().toISOString();
  const suggestions: AgentSuggestion[] = [];

  if (protectedCore) {
    suggestions.push({
      action: 'Generate parameter-sweep variants',
      actionType: 'create_variant',
      changeType: 'minor',
      confidence: 0.88,
      confirmationRequired: false,
      createdAt: now,
      details: [
        'Keep jimmy protected, then branch parameter variants freely.',
        'Sweep Donchian length, TRIX signal, ATR stop/trail, RSI levels, drawdown and drawup recovery thresholds.',
        'Rank each crypto/timeframe by profit factor, drawdown, sample size, buy-and-hold comparison and paper stability.',
      ],
      id: `agent-codex-sug-${strategyId}-variant-${Date.now()}`,
      impact: 'Create named variants while keeping the protected source intact.',
      reason: 'Backtesting is the right place to be aggressive across cryptos and timeframes.',
      risk: 'medium',
      strategyId,
      title: 'Codex: sweep strategy variants',
      type: 'test_timeframe',
      versionId,
    });
  }

  if (!latestVersion?.paperSummary) {
    suggestions.push({
      action: 'Run paper validation',
      actionType: 'run_paper_test',
      confidence: 0.79,
      confirmationRequired: false,
      createdAt: now,
      details: [
        'Paper mode records behavior without exchange orders.',
        'Run jimmy on BTC/USDT 1H first, then fan out to ETH/USDT, SOL/USDT and the selected timeframe matrix.',
        'Bot/live promotion remains separate from research.',
      ],
      id: `agent-codex-sug-${strategyId}-paper-${Date.now()}`,
      impact: 'Push promising variants through forward-style validation faster.',
      reason: 'Backtesting should move quickly into paper testing once a candidate appears.',
      risk: 'low',
      strategyId,
      title: 'Codex: extend paper validation',
      type: 'send_to_paper',
      versionId,
    });
  }

  suggestions.push({
    action: 'Create robustness report',
    actionType: 'create_report',
    confidence: latestBacktest ? 0.76 : 0.66,
    confirmationRequired: false,
    createdAt: now,
      details: [
        'Summarize backtest, paper status, drawdown and overfitting warnings.',
        'Rank winners and losers so the next sweep is obvious.',
        'Live execution remains outside this research loop.',
      ],
    id: `agent-codex-sug-${strategyId}-report-${Date.now()}`,
    impact: 'Give the user a concise decision memo before changing anything.',
    reason: latestBacktest ? 'A compact report helps compare variants.' : 'No recent backtest summary is available yet.',
    risk: 'low',
    strategyId,
      title: 'Codex: rank the current sweep',
    type: 'do_nothing',
    versionId,
  });

  return {
    provider: getStrategyAgentAiStatus(),
    suggestions: suggestions.slice(0, 3),
    summary: [
      'Codex research provider is active server-side.',
      protectedCore ? 'jimmy is read-only; variants carry all parameter experiments.' : 'Strategy can be explored through variants.',
      latestBacktest ? `${latestBacktest.profitFactor.toFixed(2)} profit factor over ${latestBacktest.totalTrades} trades.` : 'Backtest evidence is missing or stale.',
      'Backtesting, paper testing and comparison can move aggressively; live/API/Risk Rules remain separate.',
    ],
  };
}

async function callResponsesProvider(context: AgentAiContext) {
  const env = getThoonServerEnv();
  const response = await fetch(`${trimBaseUrl(env.agentAiBaseUrl)}/responses`, {
    body: JSON.stringify({
      input: buildUserPrompt(context),
      instructions: systemInstructions(),
      max_output_tokens: 900,
      model: env.agentAiModel,
      text: {
        format: {
          type: 'json_object',
        },
      },
    }),
    headers: {
      authorization: `Bearer ${env.agentAiApiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(env.agentAiTimeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string }; output?: Array<{ content?: Array<{ text?: string; type?: string }> }>; output_text?: string };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Strategy Agent AI request failed with ${response.status}.`);
  }

  return toAiResult(context, payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text' || item.text)?.text);
}

async function callChatCompatibleProvider(context: AgentAiContext) {
  const env = getThoonServerEnv();
  const response = await fetch(`${trimBaseUrl(env.agentAiBaseUrl)}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        { content: systemInstructions(), role: 'system' },
        { content: buildUserPrompt(context), role: 'user' },
      ],
      model: env.agentAiModel,
      response_format: { type: 'json_object' },
    }),
    headers: {
      authorization: `Bearer ${env.agentAiApiKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(env.agentAiTimeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Strategy Agent compatible AI request failed with ${response.status}.`);
  }

  return toAiResult(context, payload.choices?.[0]?.message?.content);
}

function toAiResult(context: AgentAiContext, rawText?: string) {
  const parsed = parseAiPayload(rawText);

  return {
    provider: getStrategyAgentAiStatus(),
    suggestions: (parsed.suggestions ?? []).slice(0, 3).map((suggestion, index): AgentSuggestion => {
      const strategyId = context.strategy?.id ?? context.versions[0]?.strategyId ?? 'strategy';
      const versionId = context.versions[0]?.id;

      return {
        action: suggestion.action || suggestion.title || 'Review',
        actionType: 'create_report',
        confidence: clamp(suggestion.confidence ?? 0.62, 0, 1),
        confirmationRequired: false,
        createdAt: new Date().toISOString(),
        details: ['Generated by configured AI provider.', 'Risk Engine still controls execution.'],
        id: `agent-ai-sug-${strategyId}-${Date.now()}-${index}`,
        impact: suggestion.impact || 'Improve validation clarity.',
        reason: suggestion.reason || 'AI provider found a review point.',
        risk: suggestion.risk ?? 'low',
        strategyId,
        title: suggestion.title || 'Review strategy',
        type: 'do_nothing',
        versionId,
      };
    }),
    summary: (parsed.summary ?? []).slice(0, 5),
  };
}

function parseAiPayload(rawText?: string): AgentAiPayload {
  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText) as AgentAiPayload;
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);

    if (!match) {
      return { summary: [rawText.slice(0, 220)] };
    }

    try {
      return JSON.parse(match[0]) as AgentAiPayload;
    } catch {
      return { summary: [rawText.slice(0, 220)] };
    }
  }
}

function systemInstructions() {
  return [
    'You are Thoon Strategy Agent, an aggressive backtesting and strategy-research analyst inside a private crypto trading app.',
    'Return strict JSON only with keys: summary (array of short strings) and suggestions (array).',
    'Each suggestion should include title, reason, impact, confidence, risk, action.',
    'Explore variants boldly for backtesting and paper testing, but do not promise profit.',
    'Do not recommend live trading, do not modify API keys, risk rules, or protected originals.',
    'Prefer parameter sweeps, market/timeframe comparisons, robustness checks, and clear ranking of candidates.',
  ].join('\n');
}

function buildUserPrompt(context: AgentAiContext) {
  return JSON.stringify({
    backtests: context.backtests.slice(0, 5),
    riskRules: context.riskRules,
    strategy: context.strategy
      ? {
          ...context.strategy,
          agentSource: context.strategy.agentSource
            ? {
                ...context.strategy.agentSource,
                sourceCode: context.strategy.agentSource.sourceCode?.slice(0, 8000),
              }
            : undefined,
        }
      : undefined,
    versions: context.versions.slice(0, 5),
  });
}

function trimBaseUrl(value: string) {
  return value.replace(/\/$/, '');
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
