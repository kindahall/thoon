import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const nextBin = join(root, 'node_modules', '.bin', 'next');
const tests = [];

test('layout and primary pages render', async ({ fetchPage }) => {
  const pages = [
    ['/charts', 'Charts'],
    ['/markets', 'Markets'],
    ['/watchlist', 'Watchlist'],
    ['/orders', 'Orders'],
    ['/alerts', 'Alerts'],
    ['/history', 'Trade Journal'],
    ['/preferences', 'Preferences'],
    ['/preferences/agent', 'Strategy Agent'],
    ['/preferences/appearance', 'Appearance'],
    ['/preferences/exchange-api', 'Exchange &amp; API'],
    ['/preferences/risk-rules', 'Risk Rules'],
    ['/agent', 'Strategy Agent'],
    ['/strategies', 'Strategies'],
    ['/strategies/core-lab', 'Jimmy Strategy Lab'],
    ['/strategies/new', 'Create Strategy'],
    ['/bots', 'Bots'],
    ['/bots/new', 'Create Bot'],
    ['/backtest', 'Backtest'],
    ['/backtest/replay', 'Paper Testing'],
  ];

  for (const [path, expected] of pages) {
    const html = await fetchPage(path);
    assertIncludes(html, 'app-shell', `${path} renders layout`);
    assertIncludes(html, expected, `${path} renders ${expected}`);
  }
});

test('strategy agent renders, protects core strategy and exposes Codex research mode', async ({ apiRequest, fetchPage, readSource }) => {
  const agent = await fetchPage('/agent');
  assertIncludes(agent, 'Strategy Agent', 'Agent dashboard renders');
  assertIncludes(agent, 'AI Provider', 'Agent dashboard shows provider');

  const preferences = await fetchPage('/preferences/agent');
  assertIncludes(preferences, 'Autonomy', 'Agent preferences render autonomy');
  assertIncludes(preferences, 'Permissions', 'Agent preferences render permissions');

  const coreLab = await fetchPage('/strategies/core-lab');
  assertIncludes(coreLab, 'Original Protected', 'Core Lab protects original');
  assertIncludes(coreLab, 'jimmy', 'Jimmy Lab renders protected Pine strategy');

  const status = await apiRequest('/api/agent/ai/status');
  const statusBody = await status.text();
  assertStatus(status, 200, 'Agent AI status endpoint is available');
  assertIncludes(statusBody, 'codex', 'Agent uses Codex research provider by default');

  const action = await apiRequest('/api/agent/actions', {
    body: JSON.stringify({ action: 'analyze_strategy', strategyId: 'strat-jimmy' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const actionBody = await action.text();
  assertStatus(action, 200, 'Agent analyze action runs');
  assertIncludes(actionBody, 'codex', 'Agent action uses Codex provider');
  assertIncludes(actionBody, 'sweep', 'Agent action proposes aggressive strategy research');

  const aiSource = await readSource('src/server/strategy-agent-ai.ts');
  assertIncludes(aiSource, 'callCodexProvider', 'Codex provider exists server-side');
  assertIncludes(aiSource, '/responses', 'OpenAI Responses provider remains available');
  assertIncludes(aiSource, '/chat/completions', 'OpenAI-compatible chat provider remains available');

  const jimmyConfigSource = await readSource('src/config/jimmy-strategy.ts');
  const strategiesSource = await readSource('src/mock-data/strategies.ts');
  const botsSource = await readSource('src/mock-data/bots.ts');
  const agentSeedSource = await readSource('src/mock-data/strategy-agent.ts');
  assertIncludes(jimmyConfigSource, 'strat-jimmy', 'jimmy strategy is seeded');
  assertIncludes(strategiesSource, 'JIMMY_STRATEGY_NAME', 'jimmy strategy has canonical name');
  assertIncludes(strategiesSource, 'export const backtestReports: BacktestReport[] = []', 'Backtest reports are not seeded with mocks');
  assertIncludes(botsSource, 'export const bots: Bot[] = []', 'Bots are not seeded with fake PnL');
  assertIncludes(agentSeedSource, 'export const agentSuggestions: AgentSuggestion[] = []', 'Agent suggestions are not seeded with mocks');

  const drawerSource = await readSource('src/components/agent/StrategyAgentDrawer.tsx');
  assertIncludes(drawerSource, 'confirmationRequired', 'Agent drawer handles confirmation-required responses');
  assertIncludes(drawerSource, 'write_journal_note', 'Agent drawer exposes journal note action');
});

test('navigation links carry pair and strategy params', async ({ fetchPage }) => {
  const watchlist = await fetchPage('/watchlist');
  assertIncludes(watchlist, 'No tracked pairs', 'Watchlist starts empty without seeded pairs');
  assertIncludes(watchlist, '/markets', 'Empty watchlist links to real market selection');

  const markets = await fetchPage('/markets');
  assertIncludes(markets, '/charts?pair=BTC%2FUSDT', 'Markets opens BTC on chart');
  assertIncludes(markets, '/watchlist?add=BTC%2FUSDT', 'Markets adds BTC to watchlist');

  const strategy = await fetchPage('/strategies/strat-jimmy');
  assertIncludes(strategy, '/backtest?strategyId=strat-jimmy', 'Strategy opens backtest');
  assertIncludes(strategy, '/bots/new?strategyId=strat-jimmy', 'Strategy creates bot');

  const backtest = await fetchPage('/backtest?strategyId=strat-jimmy');
  assertIncludes(backtest, '/backtest/replay?pair=BTC%2FUSDT&amp;strategyId=strat-jimmy', 'Backtest opens paper test');
  assertIncludes(backtest, '/bots/new?strategyId=strat-jimmy&amp;pair=BTC%2FUSDT', 'Backtest creates bot');
});

test('chart trading controls and risk engine hooks are present', async ({ fetchPage, readSource }) => {
  const chart = await fetchPage('/charts?pair=BTC%2FUSDT');
  assertIncludes(chart, 'Trade Markers', 'Trade markers render');
  assertIncludes(chart, 'Entry', 'Entry marker renders');
  assertIncludes(chart, 'Stop Loss', 'Stop loss marker renders');
  assertIncludes(chart, 'R/R', 'Position builder shows risk reward');
  assertIncludes(chart, 'Save Setup', 'Save setup action renders');
  assertIncludes(chart, '/strategies/new?pair=BTC%2FUSDT', 'Chart converts setup to strategy');
  assertIncludes(chart, '/alerts?pair=BTC%2FUSDT', 'Chart creates alert');

  const chartSource = await readSource('src/screens/charts/ChartsWorkspace.tsx');
  assertIncludes(chartSource, 'evaluateRiskEngine', 'Position Builder uses Risk Engine');
  assertIncludes(chartSource, 'setLiveOrderConfirmationOpen(true)', 'Live order opens confirmation');
  assertIncludes(chartSource, 'syncDraftWithMarker', 'Trade markers update the draft');
  assertIncludes(chartSource, 'Confirm Live Order', 'Live confirmation modal exists');

  const riskEngineSource = await readSource('src/services/risk-engine.ts');
  assertIncludes(riskEngineSource, 'stopLossPrice > 0', 'Risk Engine rejects zero stop-loss');
  assertIncludes(riskEngineSource, "errorCode: 'missing-stop-loss'", 'Risk Engine reports missing stop-loss');
});

test('bot, strategy, backtest and paper flows expose functional states', async ({ apiRequest, fetchPage, readSource }) => {
  const bot = await fetchPage('/bots/new');
  assertIncludes(bot, 'Create Bot', 'Create bot renders');
  assertIncludes(bot, 'Launch Bot', 'Bot launch action renders');

  const botSource = await readSource('src/screens/bots/NewBotPage.tsx');
  assertIncludes(botSource, 'evaluateRiskEngine', 'Create Bot uses Risk Engine');
  assertIncludes(botSource, 'Confirm Live Bot', 'Live bot confirmation exists');
  assertIncludes(botSource, 'disabled={liveBlockers.length > 0}', 'Live bot confirm is blocked by blockers');

  const strategySource = await readSource('src/screens/strategies/NewStrategyPage.tsx');
  assertIncludes(strategySource, "setStatus('Saved')", 'Strategy builder has save state');
  assertIncludes(strategySource, 'Risk Engine', 'Strategy preview displays risk engine state');

  const run = await apiRequest('/api/backtests', {
    body: JSON.stringify({
      fees: 0.06,
      initialCapital: 10000,
      period: '90D',
      slippage: 0.02,
      strategyId: 'strat-jimmy',
      symbol: 'BTC/USDT',
      timeframe: '1h',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const runBody = await run.text();
  assertStatus(run, 201, 'Backtest run returns calculated report');
  assertIncludes(runBody, '"source":"calculated"', 'Backtest report is calculated, not seeded');
  assertIncludes(runBody, '"trades"', 'Backtest report includes trade list');

  const backtest = await fetchPage('/backtest?strategyId=strat-jimmy');
  assertIncludes(backtest, 'Equity Curve', 'Backtest displays results');
  assertIncludes(backtest, 'Net Profit', 'Backtest displays net profit');
  assertIncludes(backtest, 'Candles Used', 'Backtest displays candle count');

  const replay = await fetchPage('/backtest/replay');
  assertIncludes(replay, 'Paper Trade Log', 'Paper testing displays log');
  assertIncludes(replay, 'Buy', 'Paper testing can open a buy trade');
});

test('preferences, secrets, empty states and error states are protected', async ({ fetchPage, readSource }) => {
  const appearance = await fetchPage('/preferences/appearance');
  assertIncludes(appearance, 'Save changes', 'Preferences expose save action');
  assertIncludes(appearance, 'Light', 'Theme controls render');
  assertIncludes(appearance, 'Dark', 'Theme controls render');

  const exchange = await fetchPage('/preferences/exchange-api');
  assertIncludes(exchange, 'type="password"', 'API form masks secrets');
  assertIncludes(exchange, '/preferences/audit-logs?event=api', 'API page links audit logs');

  const emptyStateSource = await readSource('src/components/ui/EmptyState.tsx');
  assertIncludes(emptyStateSource, 'ui-state', 'Empty state component exists');

  const errorStateSource = await readSource('src/components/ui/ErrorState.tsx');
  assertIncludes(errorStateSource, 'ui-state--error', 'Error state component exists');

  const riskRules = await fetchPage('/preferences/risk-rules');
  assertIncludes(riskRules, 'Block Order Test', 'Risk Rules exposes block order modal trigger');
});

test('api mutations return controlled errors and block cross-origin writes', async ({ apiRequest }) => {
  const missingAlert = await apiRequest('/api/alerts/not-real', {
    body: JSON.stringify({ status: 'paused' }),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  });
  const missingAlertBody = await missingAlert.text();

  assertStatus(missingAlert, 404, 'Missing alert returns 404');
  assertIncludes(missingAlertBody, 'Alert not found', 'Missing alert returns JSON error');

  const blockedOrigin = await apiRequest('/api/alerts', {
    body: JSON.stringify({ symbol: 'BTC/USDT' }),
    headers: { 'content-type': 'application/json', origin: 'https://example.invalid' },
    method: 'POST',
  });
  const blockedOriginBody = await blockedOrigin.text();

  assertStatus(blockedOrigin, 403, 'Cross-origin mutation returns 403');
  assertIncludes(blockedOriginBody, 'Cross-origin mutation blocked', 'Cross-origin mutation returns JSON error');
});

test('api resources and product actions are wired end-to-end', async ({ apiRequest, baseUrl }) => {
  const unique = `qa-${Date.now()}`;
  const localEquivalentOrigin = (() => {
    const url = new URL(baseUrl);

    return `${url.protocol}//localhost:${url.port}`;
  })();

  const health = await apiRequest('/api/health');
  assertStatus(health, 200, 'Health endpoint is available');
  const healthBody = await readJsonResponse(health, 'Health endpoint returns JSON');
  assert(Array.isArray(healthBody.resources), 'Health endpoint exposes API resources');
  for (const resource of ['POST /api/trading/execute', 'GET|POST /api/backtests', 'GET|POST|PATCH|DELETE /api/bots', 'GET|POST /api/setups']) {
    assert(healthBody.resources.includes(resource), `Health resource index includes ${resource}`);
  }

  const markets = await readJsonResponse(await apiRequest('/api/markets'), 'Markets endpoint returns JSON');
  assert(Array.isArray(markets.pairs) && markets.pairs.length > 0, 'Markets endpoint returns pairs');

  const candles = await readJsonResponse(await apiRequest('/api/markets/candles?symbol=BTC%2FUSDT&timeframe=1h&exchangeId=binance'), 'Candles endpoint returns JSON');
  assert(Array.isArray(candles) && candles.length >= 40, 'Candles endpoint returns enough candles for tests');

  const localhostWatchAdd = await apiRequest('/api/watchlists', {
    body: JSON.stringify({ action: 'add-pair', listId: 'favorites', symbol: 'XRP/USDT' }),
    headers: { 'content-type': 'application/json', origin: localEquivalentOrigin },
    method: 'POST',
  });
  assertStatus(localhostWatchAdd, 200, 'Equivalent localhost origin can mutate local API');
  const watchAddBody = await readJsonResponse(localhostWatchAdd, 'Watchlist add returns JSON');
  assert(watchAddBody.pairSymbols.includes('XRP/USDT'), 'Watchlist add persists pair');

  const watchRemove = await apiRequest('/api/watchlists', {
    body: JSON.stringify({ action: 'remove-pair', listId: 'favorites', symbol: 'XRP/USDT' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  assertStatus(watchRemove, 200, 'Watchlist remove succeeds');
  const watchRemoveBody = await readJsonResponse(watchRemove, 'Watchlist remove returns JSON');
  assert(!watchRemoveBody.pairSymbols.includes('XRP/USDT'), 'Watchlist remove persists removal');

  const alert = await readJsonResponse(
    await apiRequest('/api/alerts', {
      body: JSON.stringify({ channel: 'app', condition: 'above', symbol: 'BTC/USDT', trigger: 'once', type: 'price', value: '90000' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Alert creation returns JSON',
  );
  assert(alert.id && alert.symbol === 'BTC/USDT', 'Alert creation persists symbol');
  const pausedAlert = await readJsonResponse(
    await apiRequest(`/api/alerts/${encodeURIComponent(alert.id)}`, {
      body: JSON.stringify({ status: 'paused' }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
    'Alert patch returns JSON',
  );
  assertEqual(pausedAlert.status, 'paused', 'Alert status patch persists');
  const deletedAlert = await readJsonResponse(await apiRequest(`/api/alerts/${encodeURIComponent(alert.id)}`, { method: 'DELETE' }), 'Alert delete returns JSON');
  assertEqual(deletedAlert.deleted, true, 'Alert delete removes alert');

  const setup = await readJsonResponse(
    await apiRequest('/api/setups', {
      body: JSON.stringify({
        draft: { direction: 'long', entry: 65000, size: 0.05, stopLoss: 64000, takeProfit: 68000 },
        id: `setup-${unique}`,
        name: `QA setup ${unique}`,
        pair: 'BTC/USDT',
        timeframe: '1h',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Setup save returns JSON',
  );
  assertEqual(setup.id, `setup-${unique}`, 'Setup save persists explicit id');

  const strategy = await readJsonResponse(
    await apiRequest('/api/strategies', {
      body: JSON.stringify({ market: 'BTC/USDT', name: `QA Strategy ${unique}`, riskPerTrade: 0.5, status: 'draft', timeframe: '1h', type: 'trend' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Strategy creation returns JSON',
  );
  assert(strategy.id && strategy.name.includes(unique), 'Strategy creation persists record');
  const activeStrategy = await readJsonResponse(
    await apiRequest(`/api/strategies/${encodeURIComponent(strategy.id)}`, {
      body: JSON.stringify({ status: 'active' }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
    'Strategy patch returns JSON',
  );
  assertEqual(activeStrategy.status, 'active', 'Strategy patch persists status');
  const duplicatedStrategy = await readJsonResponse(
    await apiRequest(`/api/strategies/${encodeURIComponent(strategy.id)}/duplicate`, {
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Strategy duplicate returns JSON',
  );
  assert(duplicatedStrategy.id !== strategy.id && duplicatedStrategy.name.includes('Copy'), 'Strategy duplicate creates a separate draft');

  const bot = await readJsonResponse(
    await apiRequest('/api/bots', {
      body: JSON.stringify({ allocatedCapital: 2500, exchange: 'Paper', mode: 'paper', name: `QA Bot ${unique}`, riskPerTrade: 0.5, status: 'draft', strategyId: strategy.id, symbol: 'BTC/USDT' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Bot creation returns JSON',
  );
  assert(bot.id && bot.mode === 'paper', 'Bot creation persists paper bot');
  const startedBot = await readJsonResponse(
    await apiRequest(`/api/bots/${encodeURIComponent(bot.id)}/action`, {
      body: JSON.stringify({ action: 'start' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Bot action returns JSON',
  );
  assertEqual(startedBot.status, 'running', 'Bot start action persists running status');
  const stoppedBot = await readJsonResponse(
    await apiRequest(`/api/bots/${encodeURIComponent(bot.id)}`, {
      body: JSON.stringify({ status: 'stopped' }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
    'Bot patch returns JSON',
  );
  assertEqual(stoppedBot.status, 'stopped', 'Bot patch persists stopped status');

  const plannedOrder = await readJsonResponse(
    await apiRequest('/api/orders', {
      body: JSON.stringify({ exchange: 'Paper', id: `plan-${unique}`, price: 65000, side: 'buy', size: 0.01, status: 'planned', symbol: 'BTC/USDT', type: 'limit' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Planned order returns JSON',
  );
  assertEqual(plannedOrder.id, `plan-${unique}`, 'Planned order persists explicit id');
  const cancelledOrder = await readJsonResponse(
    await apiRequest(`/api/orders/${encodeURIComponent(plannedOrder.id)}`, {
      body: JSON.stringify({ status: 'cancelled' }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
    'Order cancel returns JSON',
  );
  assertEqual(cancelledOrder.status, 'cancelled', 'Order cancel persists cancelled status');

  const paperTrade = await readJsonResponse(
    await apiRequest('/api/trading/execute', {
      body: JSON.stringify({
        draft: { direction: 'long', entry: 65000, riskPercent: 0.5, size: 0.01, stopLoss: 64000, takeProfit: 68000 },
        exchangeName: 'Paper',
        mode: 'paper',
        symbol: 'BTC/USDT',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Paper trade execution returns JSON',
  );
  assertEqual(paperTrade.allowed, true, 'Paper trade passes risk engine');
  assertEqual(paperTrade.order.status, 'filled', 'Paper trade creates a filled order');

  const journalTrade = await readJsonResponse(
    await apiRequest('/api/journal', {
      body: JSON.stringify({ lessons: 'QA cleanup entry', notes: unique, pnl: 12.5, rMultiple: 0.4, side: 'long', source: 'manual', symbol: 'BTC/USDT', tag: 'qa' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Journal creation returns JSON',
  );
  assert(journalTrade.id && journalTrade.notes === unique, 'Journal creation persists note');

  const profile = await readJsonResponse(await apiRequest('/api/profile'), 'Profile endpoint returns JSON');
  const patchedProfile = await readJsonResponse(
    await apiRequest('/api/profile', {
      body: JSON.stringify({ timezone: profile.timezone }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
    'Profile patch returns JSON',
  );
  assertEqual(patchedProfile.timezone, profile.timezone, 'Profile patch persists existing timezone');

  const preferences = await readJsonResponse(await apiRequest('/api/preferences'), 'Preferences endpoint returns JSON');
  const patchedPreferences = await readJsonResponse(
    await apiRequest('/api/preferences', {
      body: JSON.stringify({ theme: preferences.preferences.theme }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
    'Preferences patch returns JSON',
  );
  assertEqual(patchedPreferences.theme, preferences.preferences.theme, 'Preferences patch persists theme');

  const riskRules = await readJsonResponse(await apiRequest('/api/risk-rules'), 'Risk rules endpoint returns JSON');
  const patchedRiskRules = await readJsonResponse(
    await apiRequest('/api/risk-rules', {
      body: JSON.stringify({ maxRiskPerTrade: riskRules.maxRiskPerTrade }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
    'Risk rules patch returns JSON',
  );
  assertEqual(patchedRiskRules.maxRiskPerTrade, riskRules.maxRiskPerTrade, 'Risk rules patch persists max risk');

  const tradeLimits = await readJsonResponse(await apiRequest('/api/trade-limits'), 'Trade limits endpoint returns JSON');
  const patchedTradeLimits = await readJsonResponse(
    await apiRequest('/api/trade-limits', {
      body: JSON.stringify({ maxOrdersPerDay: tradeLimits.maxOrdersPerDay }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
    'Trade limits patch returns JSON',
  );
  assertEqual(patchedTradeLimits.maxOrdersPerDay, tradeLimits.maxOrdersPerDay, 'Trade limits patch persists max orders');

  const exchanges = await readJsonResponse(await apiRequest('/api/exchanges'), 'Exchanges endpoint returns JSON');
  const exchangeId = exchanges.exchanges?.[0]?.id;
  assert(exchangeId, 'Exchanges endpoint returns at least one exchange');
  const exchangeTest = await readJsonResponse(
    await apiRequest('/api/exchanges/test', {
      body: JSON.stringify({ exchangeId }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Exchange test returns JSON',
  );
  assertEqual(exchangeTest.liveNetworkChecked, false, 'Exchange test stays local without pretending a live credential check');

  const apiKeyResponse = await apiRequest('/api/exchanges/api-keys', {
    body: JSON.stringify({ apiKey: `key-${unique}`, apiSecret: `secret-${unique}`, exchangeId, label: `QA key ${unique}`, permissions: ['read'] }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const apiKeyBody = await readJsonResponse(apiKeyResponse, 'API key creation returns JSON');
  if (apiKeyResponse.status === 201) {
    assert(apiKeyBody.maskedKey && !JSON.stringify(apiKeyBody).includes(`secret-${unique}`), 'API key response masks secrets');
    const revokedKey = await readJsonResponse(await apiRequest(`/api/exchanges/api-keys/${encodeURIComponent(apiKeyBody.id)}`, { method: 'DELETE' }), 'API key delete returns JSON');
    assertEqual(revokedKey.status, 'disabled', 'API key revoke disables key');
  } else {
    assertStatus(apiKeyResponse, 500, 'API key storage fails closed when encryption is not production-ready');
    assertIncludes(apiKeyBody.error, 'THOON_ENCRYPTION_KEY', 'API key storage explains encryption requirement');
  }

  const agentBacktest = await readJsonResponse(
    await apiRequest('/api/agent/actions', {
      body: JSON.stringify({ action: 'run_backtest', strategyId: 'strat-jimmy' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Agent backtest action returns JSON',
  );
  assertEqual(agentBacktest.ok, true, 'Agent run_backtest completes');
  assertEqual(agentBacktest.result.report.source, 'calculated', 'Agent run_backtest uses calculated backtest engine');
  assert(agentBacktest.result.report.candleCount >= 40, 'Agent run_backtest stores candle count');
  assert(Array.isArray(agentBacktest.result.report.trades), 'Agent run_backtest stores trade rows');

  const liveAgent = await readJsonResponse(
    await apiRequest('/api/agent/actions', {
      body: JSON.stringify({ action: 'execute_live_trade', strategyId: 'strat-jimmy' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
    'Agent live action returns JSON',
  );
  assertEqual(liveAgent.ok, false, 'Agent live action is blocked');
  assert(liveAgent.decision.blockers.join(' ').includes('forbidden'), 'Agent live action explains forbidden permission');

  await readJsonResponse(await apiRequest(`/api/journal/${encodeURIComponent(journalTrade.id)}`, { method: 'DELETE' }), 'Journal cleanup returns JSON');
  await readJsonResponse(await apiRequest(`/api/bots/${encodeURIComponent(bot.id)}`, { method: 'DELETE' }), 'Bot cleanup returns JSON');
  await readJsonResponse(await apiRequest(`/api/strategies/${encodeURIComponent(duplicatedStrategy.id)}`, { method: 'DELETE' }), 'Duplicated strategy cleanup returns JSON');
  await readJsonResponse(await apiRequest(`/api/strategies/${encodeURIComponent(strategy.id)}`, { method: 'DELETE' }), 'Strategy cleanup returns JSON');
});

test('production gates expose auth, readiness and observability contracts', async ({ apiRequest, fetchPage, readSource }) => {
  const login = await fetchPage('/login');
  assertIncludes(login, 'Unlock Thoon', 'Login page renders production auth entry');

  const session = await apiRequest('/api/auth/session');
  const sessionBody = await session.text();
  assertStatus(session, 200, 'Local session endpoint is available');
  assertIncludes(sessionBody, 'local-disabled', 'Session endpoint exposes local-disabled mode');

  const readiness = await apiRequest('/api/production/readiness');
  const readinessBody = await readiness.text();
  assertStatus(readiness, 503, 'Production readiness fails until prod env is configured');
  assertIncludes(readinessBody, 'THOON_AUTH_MODE=local-required', 'Readiness explains auth requirement');
  assertIncludes(readinessBody, 'DATABASE_URL', 'Readiness explains database requirement');

  const metrics = await apiRequest('/api/observability/metrics');
  const metricsBody = await metrics.text();
  assertStatus(metrics, 200, 'Metrics endpoint is available');
  assertIncludes(metricsBody, 'apiRequests', 'Metrics endpoint exposes API counters');

  const liveExecutorSource = await readSource('src/server/exchanges/live-executor.ts');
  assertIncludes(liveExecutorSource, '/api/v3/order/test', 'Live executor defaults to signed test endpoint');
  assertIncludes(liveExecutorSource, '/api/v3/order', 'Live executor supports real Binance endpoint');
  assertIncludes(liveExecutorSource, "request.apiKey.status !== 'active'", 'Live executor rejects non-active API keys');

  const proxySource = await readSource('src/proxy.ts');
  assertIncludes(proxySource, 'verifySessionCookie', 'Proxy validates session cookie content');
  assertIncludes(proxySource, 'crypto.subtle', 'Proxy verifies signed cookies at the edge');

  const apiRouteSource = await readSource('src/app/api/[...path]/route.ts');
  assertIncludes(apiRouteSource, 'flushPendingPostgresMirror', 'Mutations wait for durable Postgres mirror when configured');
  assertIncludes(apiRouteSource, "record.status === 'active'", 'Live order routing requires active API keys');
});

async function main() {
  if (!existsSync(nextBin)) {
    throw new Error('Next binary is missing. Run npm install first.');
  }

  let serverOutput = '';
  let server = null;
  let tempDataDir = null;
  let baseUrl = normalizeBaseUrl(process.env.THOON_TEST_BASE_URL);

  if (baseUrl) {
    await waitForServer(baseUrl);
  } else {
    const port = await getFreePort();
    tempDataDir = await mkdtemp(join(tmpdir(), 'thoon-test-'));
    baseUrl = `http://127.0.0.1:${port}`;
    const nextMode = existsSync(join(root, '.next', 'BUILD_ID')) ? 'start' : 'dev';
    server = spawn(nextBin, [nextMode, '-H', '127.0.0.1', '-p', String(port)], {
      cwd: root,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', THOON_DATA_FILE: join(tempDataDir, 'thoon-db.json') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    server.stdout.on('data', (chunk) => {
      serverOutput += chunk.toString();
    });
    server.stderr.on('data', (chunk) => {
      serverOutput += chunk.toString();
    });

    try {
      await waitForServer(baseUrl);
    } catch (error) {
      if (serverOutput) {
        console.error(serverOutput);
      }

      throw error;
    }
  }

  try {
    const context = {
      apiRequest: (path, init) => fetch(`${baseUrl}${path}`, init),
      baseUrl,
      fetchPage: (path) => fetchPage(baseUrl, path),
      readSource,
    };
    const failures = [];

    for (const item of tests) {
      try {
        await item.run(context);
        console.log(`OK ${item.name}`);
      } catch (error) {
        failures.push({ error, name: item.name });
        console.error(`FAIL ${item.name}`);
        console.error(error instanceof Error ? error.message : error);
      }
    }

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (server) {
      server.kill('SIGTERM');
      setTimeout(() => {
        if (server && !server.killed) {
          server.kill('SIGKILL');
        }
      }, 1000).unref();
    }

    if (tempDataDir) {
      await rm(tempDataDir, { force: true, recursive: true });
    }
  }

  if (process.exitCode) {
    console.error(serverOutput);
  }
}

function test(name, run) {
  tests.push({ name, run });
}

async function fetchPage(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  return html;
}

async function readSource(path) {
  return readFile(join(root, path), 'utf8');
}

function assertIncludes(value, expected, message) {
  if (!value.includes(expected)) {
    throw new Error(`${message}: expected to include ${expected}`);
  }
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertEqual(value, expected, message) {
  if (value !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  }
}

function assertStatus(response, expected, message) {
  if (response.status !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${response.status}`);
  }
}

async function readJsonResponse(response, message) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${message}: response was not JSON: ${text.slice(0, 300)}`);
  }
}

async function waitForServer(baseUrl, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/charts`);

      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(400);
  }

  throw new Error(`Timed out waiting for ${baseUrl}. ${lastError instanceof Error ? lastError.message : ''}`);
}

function normalizeBaseUrl(value) {
  return value ? value.replace(/\/$/, '') : null;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port);
          return;
        }

        reject(new Error('Could not allocate a free port.'));
      });
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
