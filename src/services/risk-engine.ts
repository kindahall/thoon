import type { PositionDraft } from '../types/market';
import type { Bot, ExchangeConnection, RiskRules, TradeLimits } from '../types/trading';
import { formatCompactUsd } from '../utils/format';
import type { TradingErrorCode } from './trading-error-service';

export type RiskEngineMode = 'live' | 'paper' | 'preview';
export type RiskEngineAction = 'execute-trade' | 'launch-live-bot' | 'create-bot' | 'planned-order' | 'strategy-preview';
export type RiskEngineSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type RiskEngineCheckStatus = 'passed' | 'warning' | 'blocked';

export type RiskEngineCheck = {
  correction: string;
  detail: string;
  errorCode?: TradingErrorCode;
  id: string;
  label: string;
  message: string;
  severity: RiskEngineSeverity;
  status: RiskEngineCheckStatus;
};

export type RiskEngineIssue = RiskEngineCheck;

export type RiskEngineResult = {
  allowed: boolean;
  blockers: RiskEngineIssue[];
  checks: RiskEngineCheck[];
  severity: RiskEngineSeverity;
  suggestedCorrection: string;
  warnings: RiskEngineIssue[];
};

type RiskEngineOrderInput = {
  accountBalance: number;
  availableBalance: number;
  dailyLossPercent?: number;
  entry?: number;
  leverage: number;
  marginRequired: number;
  openPositions: number;
  ordersToday: number;
  riskPercent: number;
  stopLoss?: number;
  symbol?: string;
  weeklyLossPercent?: number;
};

type RiskEngineBotInput = {
  allocatedCapital?: number;
  drawdownPercent?: number;
  maxLeverage?: number;
  riskPerTrade?: number;
  status?: Bot['status'];
};

export type RiskEngineInput = {
  action: RiskEngineAction;
  bot?: RiskEngineBotInput;
  exchange?: ExchangeConnection;
  mode: RiskEngineMode;
  order?: RiskEngineOrderInput;
  riskRules: RiskRules;
  tradeLimits: TradeLimits;
};

const passedCorrection = 'No action needed.';

export function evaluateRiskEngine({ action, bot, exchange, mode, order, riskRules, tradeLimits }: RiskEngineInput): RiskEngineResult {
  const liveMode = mode === 'live';
  const checks: RiskEngineCheck[] = [];
  const dailyLossPercent = order?.dailyLossPercent ?? 0;
  const weeklyLossPercent = order?.weeklyLossPercent ?? 0;
  const botDrawdown = bot?.drawdownPercent ?? 0;
  const hasOrderContext = Boolean(order);
  const hasBotContext = Boolean(bot) || action === 'launch-live-bot' || action === 'create-bot';
  const entryPrice = order?.entry ?? 0;
  const stopLossPrice = order?.stopLoss ?? 0;
  const hasStopLoss = !hasOrderContext || (Number.isFinite(stopLossPrice) && Number.isFinite(entryPrice) && stopLossPrice > 0 && entryPrice > 0 && Math.abs(entryPrice - stopLossPrice) > 0);

  addCheck(checks, {
    blocked: riskRules.blockOrdersWithoutStop && !hasStopLoss && liveMode,
    correction: 'Add a stop-loss marker before live execution.',
    detail: hasStopLoss ? 'Set' : 'Missing',
    errorCode: 'missing-stop-loss',
    id: 'stop-loss-required',
    label: 'Stop Loss',
    message: 'Stop-loss is required.',
    severity: 'critical',
    warn: riskRules.blockOrdersWithoutStop && !hasStopLoss,
  });

  addCheck(checks, {
    blocked: (order?.riskPercent ?? bot?.riskPerTrade ?? 0) > riskRules.maxRiskPerTrade,
    correction: 'Reduce risk per trade or update Risk Rules.',
    detail: `${formatPercentValue(order?.riskPercent ?? bot?.riskPerTrade ?? 0)} / max ${riskRules.maxRiskPerTrade}%`,
    errorCode: 'risk-limit-exceeded',
    id: 'max-risk-per-trade',
    label: 'Risk',
    message: 'Risk per trade exceeds the configured maximum.',
    severity: 'critical',
    warn: (order?.riskPercent ?? bot?.riskPerTrade ?? 0) >= riskRules.maxRiskPerTrade * 0.8,
  });

  addCheck(checks, {
    blocked: dailyLossPercent >= riskRules.dailyLossLimit,
    correction: 'Pause trading until the daily loss resets.',
    detail: `${formatPercentValue(dailyLossPercent)} / max ${riskRules.dailyLossLimit}%`,
    errorCode: 'risk-limit-exceeded',
    id: 'daily-loss-limit',
    label: 'Daily Loss',
    message: 'Daily loss limit reached.',
    severity: 'critical',
    warn: dailyLossPercent >= riskRules.dailyLossLimit * 0.8,
  });

  addCheck(checks, {
    blocked: weeklyLossPercent >= riskRules.weeklyLossLimit,
    correction: 'Pause trading until the weekly loss resets.',
    detail: `${formatPercentValue(weeklyLossPercent)} / max ${riskRules.weeklyLossLimit}%`,
    errorCode: 'risk-limit-exceeded',
    id: 'weekly-loss-limit',
    label: 'Weekly Loss',
    message: 'Weekly loss limit reached.',
    severity: 'critical',
    warn: weeklyLossPercent >= riskRules.weeklyLossLimit * 0.8,
  });

  addCheck(checks, {
    blocked: (order?.leverage ?? bot?.maxLeverage ?? 1) > riskRules.maxLeverage,
    correction: 'Lower leverage before submitting.',
    detail: `${order?.leverage ?? bot?.maxLeverage ?? 1}x / max ${riskRules.maxLeverage}x`,
    errorCode: 'risk-limit-exceeded',
    id: 'max-leverage',
    label: 'Leverage',
    message: 'Leverage exceeds the configured maximum.',
    severity: 'critical',
    warn: (order?.leverage ?? bot?.maxLeverage ?? 1) >= riskRules.maxLeverage * 0.8,
  });

  addCheck(checks, {
    blocked: (order?.availableBalance ?? order?.accountBalance ?? bot?.allocatedCapital ?? 0) < riskRules.minimumBalance,
    correction: 'Add balance or reduce allocation.',
    detail: `${formatCompactUsd(order?.availableBalance ?? bot?.allocatedCapital ?? 0)} / min ${formatCompactUsd(riskRules.minimumBalance)}`,
    errorCode: 'insufficient-balance',
    id: 'minimum-balance',
    label: 'Balance',
    message: 'Available balance is below the minimum.',
    severity: 'high',
    warn: (order?.availableBalance ?? order?.accountBalance ?? bot?.allocatedCapital ?? 0) < riskRules.minimumBalance * 1.2,
  });

  addCheck(checks, {
    blocked: hasOrderContext && (order?.marginRequired ?? 0) > (order?.availableBalance ?? 0) && liveMode,
    correction: 'Reduce size, lower leverage or add balance.',
    detail: `${formatCompactUsd(order?.marginRequired ?? 0)} / ${formatCompactUsd(order?.availableBalance ?? 0)}`,
    errorCode: 'insufficient-balance',
    id: 'required-margin',
    label: 'Margin',
    message: 'Required margin exceeds available balance.',
    severity: 'critical',
    warn: hasOrderContext && (order?.marginRequired ?? 0) > (order?.availableBalance ?? 0) * 0.8,
  });

  addCheck(checks, {
    blocked: liveMode && (!exchange || exchange.status !== 'connected'),
    correction: 'Reconnect the exchange or switch to paper mode.',
    detail: exchange?.status ?? 'Disconnected',
    errorCode: 'api-disconnected',
    id: 'exchange-connected',
    label: 'Exchange',
    message: 'Exchange is not connected.',
    severity: 'critical',
    warn: mode === 'paper' && (!exchange || exchange.status !== 'connected'),
  });

  addCheck(checks, {
    blocked: liveMode && !exchange?.permissions.includes('trade'),
    correction: 'Enable trade permission without withdrawals.',
    detail: exchange?.permissions.includes('trade') ? 'Trade enabled' : 'No trade permission',
    errorCode: 'invalid-api-permissions',
    id: 'api-trade-permission',
    label: 'API Permission',
    message: 'API key cannot trade.',
    severity: 'critical',
    warn: mode === 'paper' && !exchange?.permissions.includes('trade'),
  });

  addCheck(checks, {
    blocked: (order?.openPositions ?? 0) >= tradeLimits.maxOpenPositions && liveMode,
    correction: 'Close a position or increase trade limits.',
    detail: `${order?.openPositions ?? 0} / max ${tradeLimits.maxOpenPositions}`,
    errorCode: 'risk-limit-exceeded',
    id: 'max-open-positions',
    label: 'Open Positions',
    message: 'Maximum open positions reached.',
    severity: 'high',
    warn: (order?.openPositions ?? 0) >= tradeLimits.maxOpenPositions * 0.8,
  });

  addCheck(checks, {
    blocked: (order?.ordersToday ?? 0) >= tradeLimits.maxOrdersPerDay && liveMode,
    correction: 'Wait for the daily order window to reset.',
    detail: `${order?.ordersToday ?? 0} / max ${tradeLimits.maxOrdersPerDay}`,
    errorCode: 'rate-limit-exceeded',
    id: 'max-orders-per-day',
    label: 'Orders Today',
    message: 'Maximum orders per day reached.',
    severity: 'high',
    warn: (order?.ordersToday ?? 0) >= tradeLimits.maxOrdersPerDay * 0.8,
  });

  addCheck(checks, {
    blocked: hasBotContext && botDrawdown >= riskRules.stopBotsAtDrawdown && liveMode,
    correction: 'Pause the bot and review logs before relaunch.',
    detail: `${formatPercentValue(botDrawdown)} / max ${riskRules.stopBotsAtDrawdown}%`,
    errorCode: 'bot-stopped-automatically',
    id: 'bot-drawdown-limit',
    label: 'Bot Drawdown',
    message: 'Bot drawdown limit reached.',
    severity: 'critical',
    warn: hasBotContext && botDrawdown >= riskRules.stopBotsAtDrawdown * 0.8,
  });

  addCheck(checks, {
    blocked: riskRules.emergencyKillSwitch && liveMode,
    correction: 'Disable the emergency kill switch after review.',
    detail: riskRules.emergencyKillSwitch ? 'Active' : 'Clear',
    errorCode: 'order-rejected',
    id: 'emergency-kill-switch',
    label: 'Kill Switch',
    message: 'Emergency kill switch is active.',
    severity: 'critical',
    warn: riskRules.emergencyKillSwitch,
  });

  const blockers = checks.filter((check) => check.status === 'blocked');
  const warnings = checks.filter((check) => check.status === 'warning');

  return {
    allowed: blockers.length === 0,
    blockers,
    checks,
    severity: highestSeverity([...blockers, ...warnings]),
    suggestedCorrection: blockers[0]?.correction ?? warnings[0]?.correction ?? passedCorrection,
    warnings,
  };
}

export function lossPercentFromPnl(pnl: number, accountBalance: number) {
  if (pnl >= 0 || accountBalance <= 0) {
    return 0;
  }

  return Math.abs(pnl / accountBalance) * 100;
}

function addCheck(
  checks: RiskEngineCheck[],
  input: Omit<RiskEngineCheck, 'status'> & {
    blocked: boolean;
    warn?: boolean;
  },
) {
  const { blocked, warn, ...check } = input;
  const status: RiskEngineCheckStatus = blocked ? 'blocked' : warn ? 'warning' : 'passed';

  checks.push({
    ...check,
    correction: status === 'passed' ? passedCorrection : check.correction,
    severity: status === 'passed' ? 'none' : check.severity,
    status,
  });
}

function highestSeverity(issues: RiskEngineIssue[]): RiskEngineSeverity {
  const order: RiskEngineSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

  return issues.reduce<RiskEngineSeverity>((current, issue) => (order.indexOf(issue.severity) > order.indexOf(current) ? issue.severity : current), 'none');
}

function formatPercentValue(value: number) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(2)}%`;
}

export function buildRiskOrderInputFromDraft({
  accountBalance,
  availableBalance,
  dailyLossPercent,
  draft,
  leverage,
  marginRequired,
  openPositions,
  ordersToday,
  weeklyLossPercent,
}: {
  accountBalance: number;
  availableBalance: number;
  dailyLossPercent: number;
  draft: PositionDraft;
  leverage: number;
  marginRequired: number;
  openPositions: number;
  ordersToday: number;
  weeklyLossPercent: number;
}): RiskEngineOrderInput {
  return {
    accountBalance,
    availableBalance,
    dailyLossPercent,
    entry: draft.entry,
    leverage,
    marginRequired,
    openPositions,
    ordersToday,
    riskPercent: draft.riskPercent,
    stopLoss: draft.stopLoss,
    weeklyLossPercent,
  };
}
