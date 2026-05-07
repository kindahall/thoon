export type TradingErrorCode =
  | 'api-disconnected'
  | 'insufficient-balance'
  | 'order-rejected'
  | 'missing-stop-loss'
  | 'risk-limit-exceeded'
  | 'exchange-unavailable'
  | 'bot-stopped-automatically'
  | 'invalid-api-permissions'
  | 'ip-not-whitelisted'
  | 'rate-limit-exceeded'
  | 'slippage-too-high'
  | 'market-unavailable';

export type TradingErrorDefinition = {
  code: TradingErrorCode;
  correctiveAction: string;
  href?: string;
  primaryActionLabel: string;
  reason: string;
  secondaryActionLabel?: string;
  title: string;
};

const tradingErrorDefinitions: Record<TradingErrorCode, TradingErrorDefinition> = {
  'api-disconnected': {
    code: 'api-disconnected',
    correctiveAction: 'Reconnect the exchange or switch to paper mode.',
    href: '/preferences/exchange-api',
    primaryActionLabel: 'Reconnect API',
    reason: 'The selected exchange is not connected for trading.',
    secondaryActionLabel: 'Use Paper',
    title: 'API disconnected',
  },
  'insufficient-balance': {
    code: 'insufficient-balance',
    correctiveAction: 'Reduce size, lower leverage or add balance.',
    href: '/orders',
    primaryActionLabel: 'Edit Order',
    reason: 'Required margin is higher than available balance.',
    secondaryActionLabel: 'Cancel',
    title: 'Insufficient balance',
  },
  'order-rejected': {
    code: 'order-rejected',
    correctiveAction: 'Review the risk checks and submit again.',
    href: '/charts',
    primaryActionLabel: 'Edit Order',
    reason: 'The order failed one or more execution checks.',
    secondaryActionLabel: 'Cancel',
    title: 'Order rejected',
  },
  'missing-stop-loss': {
    code: 'missing-stop-loss',
    correctiveAction: 'Add a stop-loss marker before live execution.',
    href: '/charts',
    primaryActionLabel: 'Edit Stop',
    reason: 'Live orders require a defined stop-loss.',
    secondaryActionLabel: 'Cancel',
    title: 'Missing stop-loss',
  },
  'risk-limit-exceeded': {
    code: 'risk-limit-exceeded',
    correctiveAction: 'Lower risk, size or leverage to fit the rule.',
    href: '/preferences/risk-rules',
    primaryActionLabel: 'Review Risk',
    reason: 'Estimated risk is above the configured maximum.',
    secondaryActionLabel: 'Edit Order',
    title: 'Risk limit exceeded',
  },
  'exchange-unavailable': {
    code: 'exchange-unavailable',
    correctiveAction: 'Wait for exchange recovery or use another venue.',
    href: '/preferences/exchange-api',
    primaryActionLabel: 'Check Exchange',
    reason: 'The venue is temporarily unavailable.',
    secondaryActionLabel: 'Cancel',
    title: 'Exchange unavailable',
  },
  'bot-stopped-automatically': {
    code: 'bot-stopped-automatically',
    correctiveAction: 'Inspect logs, then restart in paper mode first.',
    href: '/bots',
    primaryActionLabel: 'Open Bot',
    reason: 'Automation stopped after a configured safety rule triggered.',
    secondaryActionLabel: 'Logs',
    title: 'Bot stopped automatically',
  },
  'invalid-api-permissions': {
    code: 'invalid-api-permissions',
    correctiveAction: 'Enable required read/trade permissions without withdrawals.',
    href: '/preferences/exchange-api',
    primaryActionLabel: 'Fix Permissions',
    reason: 'The API key does not allow the requested action.',
    secondaryActionLabel: 'Cancel',
    title: 'Invalid API permissions',
  },
  'ip-not-whitelisted': {
    code: 'ip-not-whitelisted',
    correctiveAction: 'Add the current server IP to the exchange whitelist.',
    href: '/preferences/exchange-api',
    primaryActionLabel: 'Update IP',
    reason: 'The exchange rejected the request from this IP.',
    secondaryActionLabel: 'Cancel',
    title: 'IP not whitelisted',
  },
  'rate-limit-exceeded': {
    code: 'rate-limit-exceeded',
    correctiveAction: 'Wait for cooldown or reduce bot/order frequency.',
    href: '/preferences/trade-limits',
    primaryActionLabel: 'Trade Limits',
    reason: 'Too many requests were sent in a short period.',
    secondaryActionLabel: 'Cancel',
    title: 'Rate limit exceeded',
  },
  'slippage-too-high': {
    code: 'slippage-too-high',
    correctiveAction: 'Use a limit order or lower accepted slippage.',
    href: '/preferences/trading-defaults',
    primaryActionLabel: 'Edit Slippage',
    reason: 'Estimated execution slippage is above the allowed value.',
    secondaryActionLabel: 'Cancel',
    title: 'Slippage too high',
  },
  'market-unavailable': {
    code: 'market-unavailable',
    correctiveAction: 'Choose another pair or wait for market data.',
    href: '/markets',
    primaryActionLabel: 'Open Markets',
    reason: 'The selected market is unavailable for execution.',
    secondaryActionLabel: 'Cancel',
    title: 'Market unavailable',
  },
};

export function getTradingErrorDefinition(code: TradingErrorCode) {
  return tradingErrorDefinitions[code];
}

export function listTradingErrorDefinitions() {
  return Object.values(tradingErrorDefinitions);
}
