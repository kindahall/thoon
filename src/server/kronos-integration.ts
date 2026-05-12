export type KronosIntegrationProfile = {
  cautions: string[];
  integrationPath: string[];
  modelZoo: Array<{ context: number; name: string; openSource: boolean; params: string; tokenizer: string }>;
  performanceUseCases: string[];
  repoUrl: string;
  runtime: string[];
  summary: string;
};

export function getKronosIntegrationProfile(): KronosIntegrationProfile {
  return {
    cautions: [
      'Kronos forecasts are raw probabilistic market predictions, not validated trade signals.',
      'Every signal must pass Thoon backtests, out-of-sample checks, paper testing, fees, slippage and Risk Engine gates.',
      'The useful path is a Python sidecar or worker; the Next.js UI should not load torch models directly.',
    ],
    integrationPath: [
      'Create a Python Kronos worker fed by Thoon candle snapshots.',
      'Store forecast paths and confidence bands as research evidence, not as orders.',
      'Evaluate forecasts against later candles and adjust the Kronos confidence weight used by Thoonix.',
      'Use forecasts to rank markets, regimes and strategies before strict backtesting.',
      'Fine-tune only after enough local Binance/DEX candle history is archived and versioned.',
    ],
    modelZoo: [
      { context: 2048, name: 'Kronos-mini', openSource: true, params: '4.1M', tokenizer: 'Kronos-Tokenizer-2k' },
      { context: 512, name: 'Kronos-small', openSource: true, params: '24.7M', tokenizer: 'Kronos-Tokenizer-base' },
      { context: 512, name: 'Kronos-base', openSource: true, params: '102.3M', tokenizer: 'Kronos-Tokenizer-base' },
      { context: 512, name: 'Kronos-large', openSource: false, params: '499.2M', tokenizer: 'Kronos-Tokenizer-base' },
    ],
    performanceUseCases: [
      'Pre-filter the top-100 USDT universe so the agent spends backtest budget on markets with forecast asymmetry.',
      'Detect regime shifts and avoid testing trend strategies in forecasted chop.',
      'Generate expected path bands for stop-loss, take-profit and trailing-stop stress tests.',
      'Compare Kronos forecast direction with strategy entries to penalize weak or contradictory candidates.',
      'Batch forecast multiple assets/timeframes to schedule smarter paper-test priorities.',
      'Learn from hit/miss history so Thoonix trusts Kronos more only after measured accuracy improves.',
    ],
    repoUrl: 'https://github.com/shiyu-coder/Kronos',
    runtime: ['Python 3.10+', 'torch>=2.0.0', 'pandas/numpy', 'huggingface_hub', 'optional GPU for batch forecasts and fine-tuning'],
    summary: 'Kronos is an open-source foundation model family for financial candlestick/K-line forecasting across OHLCV sequences.',
  };
}

export function kronosContextPrompt() {
  const profile = getKronosIntegrationProfile();

  return [
    `Repo: ${profile.repoUrl}`,
    profile.summary,
    `Runtime: ${profile.runtime.join(', ')}.`,
    `Models: ${profile.modelZoo.map((model) => `${model.name} ${model.params} context ${model.context}${model.openSource ? '' : ' closed'}`).join('; ')}.`,
    `Best Thoon uses: ${profile.performanceUseCases.join(' | ')}`,
    `Cautions: ${profile.cautions.join(' | ')}`,
    `Integration path: ${profile.integrationPath.join(' -> ')}`,
  ].join('\n');
}
