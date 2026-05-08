import type { AgentQueueTask, AgentReport, AgentRun, AgentSettings, AgentSuggestion, StrategyVersion } from '../types/trading';

export const defaultAgentSettings: AgentSettings = {
  askBefore: {
    archive_variant: true,
    create_draft_bot: true,
    create_variant: false,
    prepare_bot: true,
    promote_version: true,
    run_backtest: false,
    run_paper_test: false,
    send_to_paper: false,
  },
  enabled: true,
  instructions: {
    allowedMarkets: 'BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT, LINK/USDT, AVAX/USDT.',
    allowedParameters:
      'Only jimmy inputs: TRIX length/signal, MA type/lengths, Donchian length, RSI levels, ATR stop/trail multipliers, drawdown/drawup lookbacks and recovery thresholds, risk percent.',
    archiveRules: 'Archive weak variants only. The protected jimmy source is never archived or replaced.',
    forbiddenParameters: 'API keys, live trading, withdrawal permissions, trade limits, leverage increase, stop-loss removal, editing the protected jimmy source.',
    general:
      'jimmy is the protected core strategy. Codex may create separate named strategies and variants from public research or parameter sweeps, while keeping the Pine logic protected when a variant is jimmy-based.',
    mainStrategy: 'jimmy is the protected core strategy; other named strategies stay separate.',
    paperTestingRules: 'Paper testing is required before any bot is considered live-ready.',
    promotionRules: 'Explore broadly in backtest. Promote only after enough trades, acceptable drawdown and no critical warnings.',
    reportStyle: 'Short summary first, details collapsed.',
    validationRules:
      'For each crypto/timeframe, rank jimmy variants by profit factor, max drawdown, sample size, buy-and-hold comparison and paper behavior. Keep only the strongest candidate parameters.',
  },
  limits: {
    allowedMarkets: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'LINK/USDT', 'AVAX/USDT'],
    allowedTimeframes: ['5m', '15m', '30m', '1h', '2h', '4h'],
    maxBacktestsPerDay: 120,
    maxDrawdownCandidate: 10,
    maxVariantsPerDay: 40,
    minPaperDays: 14,
    minProfitFactor: 1.2,
    minTrades: 30,
    paperRequiredBeforeLive: true,
  },
  mode: 'limited_autonomous',
  neverWithoutConfirmation: {
    archive_variant: true,
    execute_live_trade: true,
    launch_live_bot: true,
    promote_version: true,
  },
  permissions: {
    analyze_strategy: true,
    archive_variant: true,
    close_positions: false,
    create_draft_bot: true,
    create_report: true,
    create_variant: true,
    delete_strategy: false,
    edit_original_strategy: false,
    edit_variant: true,
    execute_live_trade: false,
    launch_live_bot: false,
    modify_api_keys: false,
    modify_risk_rules: false,
    modify_trade_limits: false,
    prepare_bot: true,
    promote_version: true,
    read_audit_logs: true,
    read_journal: true,
    revoke_api_key: false,
    run_backtest: true,
    run_paper_test: true,
    suggest_risk_change: true,
    write_journal_note: true,
  },
  policies: {
    analyze_strategy: 'auto_allowed',
    archive_variant: 'always_confirm',
    create_draft_bot: 'ask_first',
    create_report: 'auto_allowed',
    create_variant: 'auto_allowed',
    execute_live_trade: 'forbidden',
    launch_live_bot: 'forbidden',
    prepare_bot: 'ask_first',
    promote_version: 'always_confirm',
    run_backtest: 'auto_allowed',
    run_paper_test: 'auto_allowed',
    send_to_paper: 'auto_allowed',
  },
  queuePaused: false,
};

export const strategyVersions: StrategyVersion[] = [];

export const agentSuggestions: AgentSuggestion[] = [];

export const agentRuns: AgentRun[] = [];

export const agentReports: AgentReport[] = [];

export const agentQueueTasks: AgentQueueTask[] = [];
