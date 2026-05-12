import { JIMMY_LEGACY_STRATEGY_IDS, JIMMY_SOURCE_ID, JIMMY_STRATEGY_ID } from '../config/jimmy-strategy';
import type { Timeframe } from '../types/market';
import type { Strategy, StrategyCondition, StrategyResearchRecord } from '../types/trading';

export function visibleStrategyRecords(strategyRecords: Strategy[], researchRecords: StrategyResearchRecord[] = []) {
  const canonicalStrategies = strategyRecords.filter((strategy) => !JIMMY_LEGACY_STRATEGY_IDS.includes(strategy.id));
  const existingIds = new Set(canonicalStrategies.map((strategy) => strategy.id));
  const researchStrategies = researchRecords
    .map((record) => strategyFromResearchRecord(record, canonicalStrategies))
    .filter((strategy) => {
      if (existingIds.has(strategy.id)) {
        return false;
      }

      existingIds.add(strategy.id);
      return true;
    });

  return [...canonicalStrategies, ...researchStrategies];
}

export function findVisibleStrategyRecord(strategyRecords: Strategy[], researchRecords: StrategyResearchRecord[], id: string | undefined) {
  const strategies = visibleStrategyRecords(strategyRecords, researchRecords);
  const canonicalId = canonicalStrategyId(id);

  return strategies.find((strategy) => strategy.id === canonicalId);
}

export function canonicalStrategyId(id: string | undefined) {
  if (!id || JIMMY_LEGACY_STRATEGY_IDS.includes(id)) {
    return JIMMY_STRATEGY_ID;
  }

  return id;
}

export function strategyIdFromResearchRecord(record: StrategyResearchRecord) {
  return `strat-tv-${tradingViewScriptSlug(record.url, record.title)}`;
}

export function isResearchOnlyStrategy(strategy: Strategy | undefined) {
  return Boolean(strategy?.agentSource?.sourceId.startsWith('tradingview:'));
}

export function isInnovationStrategy(strategy: Strategy | undefined) {
  return Boolean(strategy?.agentSource?.sourceId.startsWith('agent-innovation:'));
}

export function isExecutableStrategy(strategy: Strategy | undefined) {
  return Boolean(strategy && (strategy.id === JIMMY_STRATEGY_ID || strategy.agentSource?.sourceId === JIMMY_SOURCE_ID || isResearchOnlyStrategy(strategy) || isInnovationStrategy(strategy)));
}

function strategyFromResearchRecord(record: StrategyResearchRecord, canonicalStrategies: Strategy[]): Strategy {
  const sourceStrategy = canonicalStrategies.find((strategy) => strategy.id === canonicalStrategyId(record.strategyId)) ?? canonicalStrategies.find((strategy) => strategy.id === JIMMY_STRATEGY_ID);
  const timeframe = inferTimeframe(record, sourceStrategy?.timeframe ?? '1h');
  const market = sourceStrategy?.market ?? 'BTC/USDT';

  return {
    agentSource: {
      directionBias: inferDirectionBias(record),
      language: 'pine-v5',
      originalTimeframe: timeframe,
      parameters: buildResearchParameters(record),
      protectedCore: false,
      sourceId: `tradingview:${tradingViewScriptSlug(record.url, record.title)}`,
      summary: buildResearchSummary(record),
    },
    entryConditions: buildResearchEntryConditions(record),
    exitConditions: buildResearchExitConditions(record),
    id: strategyIdFromResearchRecord(record),
    market,
    name: record.title,
    performance30d: 0,
    riskPerTrade: sourceStrategy?.riskPerTrade ?? 1,
    riskSettings: sourceStrategy?.riskSettings,
    status: 'active',
    timeframe,
    type: inferStrategyType(record),
    updatedAt: record.fetchedAt,
  };
}

function buildResearchParameters(record: StrategyResearchRecord) {
  const parameters = [
    { label: 'Source', value: record.provider },
    { label: 'Source policy', value: record.sourcePolicy.replace(/_/g, ' ') },
    { label: 'Visibility', value: record.sourceVisibility.replace(/_/g, ' ') },
    { label: 'TradingView URL', value: record.url },
  ];

  for (const concept of record.concepts.slice(0, 6)) {
    parameters.push({ label: 'Concept', value: concept });
  }

  return parameters;
}

function buildResearchSummary(record: StrategyResearchRecord) {
  const sourceMode = record.sourcePolicy === 'concept_only' ? 'concept-only public metadata' : record.sourcePolicy.replace(/_/g, ' ');
  const concepts = record.concepts.length ? record.concepts.slice(0, 4).join(', ') : 'manual review required';

  return `TradingView research candidate from ${sourceMode}. Concepts: ${concepts}. No performance is assumed until a real candle-engine implementation is added.`;
}

function buildResearchEntryConditions(record: StrategyResearchRecord): StrategyCondition[] {
  const conditions: StrategyCondition[] = [];
  const push = (field: string, operator: StrategyCondition['operator'], value: string, connector: StrategyCondition['connector'] = conditions.length ? 'AND' : 'IF') => {
    conditions.push({ connector, field, id: `cond-${conditions.length + 1}`, operator, value });
  };

  if (hasConcept(record, 'TRIX momentum')) {
    push('TRIX', 'crosses-above', 'signal');
  }

  if (hasConcept(record, 'Donchian breakout')) {
    push('Close', 'greater-than', 'Donchian breakout level', conditions.length ? 'OR' : 'IF');
  }

  if (hasConcept(record, 'RSI regime filter')) {
    push('RSI', 'less-than', 'oversold threshold', conditions.length ? 'OR' : 'IF');
  }

  if (hasConcept(record, 'EMA/SMA trend filter')) {
    push('Fast MA', 'greater-than', 'slow MA');
  }

  if (hasConcept(record, 'ADX trend strength')) {
    push('ADX', 'greater-than', 'trend threshold');
  }

  if (hasConcept(record, 'Volume filter')) {
    push('Volume', 'greater-than', 'average volume');
  }

  if (!conditions.length) {
    push('TradingView concept', 'greater-than', 'manual validation threshold');
  }

  return conditions;
}

function buildResearchExitConditions(record: StrategyResearchRecord): StrategyCondition[] {
  const conditions: StrategyCondition[] = [
    { connector: 'IF', field: 'Risk rule', id: 'exit-risk', operator: 'greater-than', value: 'stop or invalidation level' },
  ];

  if (hasConcept(record, 'ATR stop or trail')) {
    conditions.push({ connector: 'OR', field: 'ATR trail', id: 'exit-atr', operator: 'crosses-below', value: 'price' });
  }

  if (hasConcept(record, 'EMA/SMA trend filter')) {
    conditions.push({ connector: 'OR', field: 'Close', id: 'exit-ma', operator: 'crosses-below', value: 'trend MA' });
  }

  if (hasConcept(record, 'Partial take profit')) {
    conditions.push({ connector: 'OR', field: 'Target', id: 'exit-partial', operator: 'greater-than', value: 'partial take-profit level' });
  }

  return conditions;
}

function hasConcept(record: StrategyResearchRecord, concept: string) {
  return record.concepts.includes(concept);
}

function inferStrategyType(record: StrategyResearchRecord): Strategy['type'] {
  const text = `${record.title} ${record.publicDescription} ${record.tags.join(' ')} ${record.concepts.join(' ')}`.toLowerCase();

  if (text.includes('grid')) {
    return 'grid';
  }

  if (text.includes('mean') || text.includes('reversion') || text.includes('detrended')) {
    return 'mean-reversion';
  }

  if (text.includes('donchian') || text.includes('breakout')) {
    return 'breakout';
  }

  return 'trend';
}

function inferDirectionBias(record: StrategyResearchRecord): NonNullable<Strategy['agentSource']>['directionBias'] {
  const text = `${record.title} ${record.publicDescription}`.toLowerCase();

  if (text.includes('long only') || text.includes('long-only')) {
    return 'long';
  }

  if (text.includes('short only') || text.includes('short-only')) {
    return 'short';
  }

  return 'both';
}

function inferTimeframe(record: StrategyResearchRecord, fallback: Timeframe): Timeframe {
  const text = `${record.title} ${record.publicDescription} ${record.tags.join(' ')}`.toLowerCase();
  const candidates: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'];

  for (const timeframe of candidates) {
    if (text.includes(timeframe.toLowerCase())) {
      return timeframe;
    }
  }

  if (/\b1\s*hour\b|\bhourly\b/.test(text)) {
    return '1h';
  }

  if (/\bdaily\b|\b1\s*day\b/.test(text)) {
    return '1d';
  }

  return fallback;
}

function tradingViewScriptSlug(url: string, fallback: string) {
  const scriptSlug = url.match(/\/script\/([^/]+)/)?.[1] ?? fallback;

  return slug(scriptSlug).slice(0, 72);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tradingview';
}
