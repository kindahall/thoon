import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const nextBin = join(root, 'node_modules', '.bin', 'next');
const tests = [];
const testAdminEmail = 'e2e-owner@thoon.local';
const testAdminPassword = 'e2e-admin-password-123';
const testAdminPasswordHash = 'pbkdf2_sha256$310000$2mnroyUR4Tucq8tmE_FvHg$P4vCeukoNKLuLEpqHgvcq0E2zGBSS7W8OrhGnI-WrA8';

test('Thoon/Bud primary pages render with global Bud state', async ({ fetchPage, rawRequest }) => {
  const pages = [
    ['/charts', 'Charts'],
    ['/markets', 'Markets'],
    ['/watchlist', 'Watchlist'],
    ['/agents', 'Agents'],
    ['/agent', 'Agents'],
    ['/backtest', 'Backtest'],
    ['/strategies', 'Strategies'],
    ['/bots', 'Bots'],
    ['/orders', 'Orders'],
    ['/alerts', 'Alerts'],
    ['/history', 'History'],
    ['/exchanges', 'Exchanges'],
    ['/preferences', 'Preferences'],
  ];

  for (const [path, expected] of pages) {
    const html = await fetchPage(path);
    assertIncludes(html, 'app-shell', `${path} renders the app shell`);
    assertIncludes(html, 'bud-state-strip', `${path} renders global Bud status`);
    assertIncludes(html, expected, `${path} renders ${expected}`);
  }

  for (const path of ['/strategies/new', '/strategies/core-lab', '/bots/new', '/backtest/replay', '/top-strategies']) {
    const response = await rawRequest(path);
    assertStatus(response, 404, `${path} stays removed from the rebuilt Thoon/Bud surface`);
  }
});

test('Bud backend status, capabilities and safety gates are live', async ({ apiRequest }) => {
  const status = await readJsonResponse(await apiRequest('/api/bud/status'), 'Bud status returns JSON');
  assertEqual(status.source, 'thoon_bud_backend', 'Bud status source is explicit');
  assertEqual(status.status, 'online', 'Bud backend is online');
  assertEqual(status.health?.status, 'ok', 'Bud backend health is ok');
  assertEqual(status.health?.binance_rest, 'ok', 'Binance REST health is ok');
  assert(status.capabilities?.supported_exchanges?.includes('binance'), 'Binance is supported');
  assert(status.capabilities?.supported_exchanges?.includes('bybit'), 'Bybit is supported');
  assert(status.capabilities?.supported_exchanges?.includes('bitget'), 'Bitget is supported');
  assert(status.capabilities?.supported_exchanges?.includes('hyperliquid'), 'Hyperliquid is supported');
  assert(status.capabilities?.supported_exchanges?.includes('dydx'), 'dYdX is supported');
  assertEqual(status.capabilities?.default_mode, 'paper', 'Paper trading is the default mode');
  assertEqual(status.capabilities?.live_trading_enabled, false, 'Live trading is blocked by default');

  const processStatus = await readJsonResponse(await apiRequest('/api/bud/process'), 'Bud process status returns JSON');
  assert(processStatus.payload?.running === true, 'Bud backend process is running');
  assert(processStatus.payload?.pid || processStatus.payload?.managed === false, 'Bud backend exposes a process id when managed or reports an external running process');

  const killSwitch = await resetKillSwitch(apiRequest, 'functional safety gate setup');
  assertEqual(killSwitch.active, false, 'Kill switch is clear before tests');

  const readiness = unwrapPayload(await readJsonResponse(await apiRequest('/api/bud/live-readiness'), 'Live readiness returns JSON'));
  assertEqual(readiness.live_ready, false, 'Live readiness remains blocked without production credentials');
  assert(Array.isArray(readiness.blockers) && readiness.blockers.length > 0, 'Live readiness explains blockers');
  assert(readiness.blockers.some((blocker) => String(blocker).includes('live_trading_disabled')), 'Live readiness includes disabled live trading blockers');

  const hedgeFund = unwrapPayload(await readJsonResponse(await apiRequest('/api/bud/hedge-fund-readiness'), 'Hedge fund readiness returns JSON'));
  assertEqual(hedgeFund.liveReady, false, 'Hedge fund readiness remains blocked until institutional gates pass');
  assertEqual(hedgeFund.roadmap, 'ROADMAP_HEDGEFUND_MODULES.md', 'Hedge fund readiness points to the imported roadmap');
  assert(Array.isArray(hedgeFund.gates) && hedgeFund.gates.length === 12, 'Hedge fund readiness checks the 12 final roadmap gates');
  assert(Array.isArray(hedgeFund.blockers) && hedgeFund.blockers.length > 0, 'Hedge fund readiness exposes blocking evidence');

  const walletReadiness = unwrapPayload(await readJsonResponse(await apiRequest('/api/wallets/readiness'), 'Wallet readiness returns JSON'));
  assertEqual(walletReadiness.liveReady, false, 'Wallet and DEX readiness remains blocked without signers and production gates');
  assert(Array.isArray(walletReadiness.venues) && walletReadiness.venues.length >= 5, 'Wallet readiness checks CEX and DEX target venues');
  assert(walletReadiness.blockers.includes('walletconnect_sdk_not_installed') || walletReadiness.walletConnect?.status, 'WalletConnect status is explicit');

  const liveConnectors = unwrapPayload(await readJsonResponse(await apiRequest('/api/live-connectors/readiness'), 'Live connector readiness returns JSON'));
  assertEqual(liveConnectors.liveReady, false, 'Live connector readiness remains blocked by default');
  assertEqual(liveConnectors.global?.liveOperatorMode, 'single-user', 'Live connector readiness defaults to single-user mode');
  assert(Array.isArray(liveConnectors.venues) && liveConnectors.venues.length === 5, 'Live connector readiness checks three CEX and two DEX venues');
  assert(liveConnectors.venues.some((venue) => venue.id === 'binance' && venue.kind === 'cex'), 'Binance server connector readiness is exposed');
  assert(liveConnectors.venues.some((venue) => venue.id === 'hyperliquid' && venue.signer?.officialAdapterRequired === true), 'Hyperliquid official signer blocker is explicit');
  assert(liveConnectors.venues.some((venue) => venue.id === 'dydx' && venue.signer?.officialAdapterRequired === true), 'dYdX official signer blocker is explicit');
  assert(liveConnectors.blockers.includes('bud_execution_live_trading_not_enabled') || liveConnectors.blockers.includes('thoon_app_mode_not_live_enabled'), 'Live connector readiness explains global live blockers');

  const deterministicAgents = unwrapPayload(await readJsonResponse(await apiRequest('/api/strategy-agents/deterministic'), 'Deterministic agents status returns JSON'));
  assert(Array.isArray(deterministicAgents.agents) && deterministicAgents.agents.length === 2, 'Two deterministic non-LLM TradingView agents are registered');
});

test('Bud backtest uses real Binance candles, costs and walk-forward validation', async ({ apiRequest }) => {
  const response = await apiRequest('/api/bud/backtest', {
    body: JSON.stringify({
      interval: '1h',
      limit: 240,
      symbol: 'BTCUSDT',
      validate_data_quality: true,
      walk_forward_validate: true,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const report = unwrapPayload(await readJsonResponse(response, 'Bud backtest returns JSON'));

  assertStatus(response, 200, 'Bud backtest succeeds');
  assertEqual(report.symbol, 'BTCUSDT', 'Backtest symbol is normalized');
  assertEqual(report.interval, '1h', 'Backtest interval is preserved');
  assert(report.rows >= 240, 'Backtest uses requested historical rows');
  assertEqual(report.data_quality?.exchange, 'binance', 'Backtest provenance is Binance');
  assertEqual(report.data_quality?.usable_for_backtest, true, 'Backtest data quality is usable');
  assert(report.metrics && typeof report.metrics.total_return === 'number', 'Backtest metrics are calculated');
  assert(report.metrics && 'sharpe_ratio' in report.metrics, 'Backtest exposes Sharpe');
  assert(report.metrics && 'max_drawdown' in report.metrics, 'Backtest exposes drawdown');
  assert(report.walk_forward && Array.isArray(report.walk_forward.fold_results), 'Walk-forward folds are calculated');
  assert(String(report.transaction_costs?.orderbook_source ?? '').includes('binance'), 'Transaction costs use a real Binance order book source');
});

test('Bud research registry is persisted in PostgreSQL and returns real evaluations', async ({ apiRequest }) => {
  const registry = unwrapPayload(await readJsonResponse(await apiRequest('/api/bud/research?limit=10'), 'Bud research registry returns JSON'));

  assert(Array.isArray(registry.runs), 'Research registry returns runs');
  assert(Array.isArray(registry.strategies), 'Research registry returns strategies');
  assert(Array.isArray(registry.evaluations), 'Research registry returns evaluations');
  assert(registry.runs.length >= 1, 'At least one research run is stored');
  assert(registry.strategies.length >= 1, 'At least one evaluated strategy is stored');
  assert(registry.evaluations.length >= 1, 'At least one evaluation is stored');
  const strategyTypes = new Set(registry.strategies.map((strategy) => strategy.strategy_type).filter(Boolean));
  assert(strategyTypes.size >= 4, 'Research registry stores a multi-family strategy set');
  assert(strategyTypes.has('sma_cross'), 'Research registry keeps SMA cross baseline candidates');
  assert(strategyTypes.has('rsi_mean_reversion') || strategyTypes.has('bollinger_reversion'), 'Research registry includes mean-reversion candidates');
  assert(strategyTypes.has('momentum_volatility') || strategyTypes.has('volume_breakout') || strategyTypes.has('donchian_breakout'), 'Research registry includes breakout or momentum candidates');
});

test('Bud paper execution is based on live market price and live order paths are blocked', async ({ apiRequest }) => {
  await resetKillSwitch(apiRequest, 'functional paper and live route setup');

  const blockedLive = await apiRequest('/api/bud/paper', {
    body: JSON.stringify({ liveTrading: true, quantity: 0.0001, side: 'buy', symbol: 'BTCUSDT' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const blockedLiveBody = await blockedLive.text();
  assertStatus(blockedLive, 403, 'Paper route blocks live trading payloads');
  assertIncludes(blockedLiveBody, 'only allows paper trading', 'Live payload block is explicit');

  await resetKillSwitch(apiRequest, 'functional manual live routing setup');

  const blockedLiveTrade = await apiRequest('/api/bud/trade', {
    body: JSON.stringify({ exchange: 'binance', live_trading: true, paper_trading: false, quantity: 0.0001, side: 'buy', symbol: 'BTCUSDT' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const blockedLiveTradeBody = await blockedLiveTrade.text();
  assertStatus(blockedLiveTrade, 428, 'Bud trade route requires explicit manual confirmation before live routing');
  assertIncludes(blockedLiveTradeBody, 'Manual live trading requires explicit user confirmation', 'Bud live trade gate explains the missing user confirmation');

  const manualLiveTrade = await apiRequest('/api/bud/trade', {
    body: JSON.stringify({ confirmed: true, exchange: 'binance', execution_source: 'manual', live_trading: true, paper_trading: false, quantity: 0.0001, side: 'buy', symbol: 'BTCUSDT' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const manualLiveTradeBody = await manualLiveTrade.text();
  assertStatus(manualLiveTrade, 403, 'Confirmed manual live trades pass the hedge-fund gate and stop on the technical live executor gate in default env');
  assert(!manualLiveTradeBody.includes('hedge fund readiness'), 'Manual live trade is not blocked by hedge fund readiness gates');
  assertIncludes(manualLiveTradeBody, 'live trading is disabled', 'Manual live trade reaches Bud live executor safety gate');

  const orchestratedLiveTrade = await apiRequest('/api/bud/trade', {
    body: JSON.stringify({ confirmed: true, exchange: 'binance', execution_source: 'orchestrator', live_trading: true, paper_trading: false, quantity: 0.0001, side: 'buy', symbol: 'BTCUSDT' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const orchestratedLiveTradeBody = await orchestratedLiveTrade.text();
  assertStatus(orchestratedLiveTrade, 403, 'Orchestrated live trades stay blocked until hedge fund gates pass');
  assertIncludes(orchestratedLiveTradeBody, 'hedge fund readiness', 'Orchestrated live trade gate still uses hedge fund readiness');

  const paperTradeResponse = await apiRequest('/api/bud/trade', {
    body: JSON.stringify({
      client_order_id: `thoon-trade-functional-${Date.now()}`,
      exchange: 'binance',
      paper_trading: true,
      quantity: 0.0001,
      side: 'buy',
      symbol: 'BTCUSDT',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const paperTrade = unwrapPayload(await readJsonResponse(paperTradeResponse, 'Bud paper trade route returns JSON'));
  assertStatus(paperTradeResponse, 200, 'Bud trade route can place a paper order');
  assertEqual(paperTrade.mode, 'paper', 'Bud trade route keeps paper mode by default');

  const orderResponse = await apiRequest('/api/bud/paper', {
    body: JSON.stringify({
      client_order_id: `thoon-functional-${Date.now()}`,
      quantity: 0.0001,
      side: 'buy',
      symbol: 'BTCUSDT',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const order = unwrapPayload(await readJsonResponse(orderResponse, 'Paper order returns JSON'));
  assertStatus(orderResponse, 200, 'Paper order succeeds');
  assert(String(order.symbol ?? order.order?.symbol ?? '').includes('BTC'), 'Paper order keeps the requested symbol');
  assert(Number(order.price ?? order.execution_price ?? order.order?.price ?? 0) > 0, 'Paper order uses a real positive market price');

  const paper = unwrapPayload(await readJsonResponse(await apiRequest('/api/bud/paper?symbol=BTCUSDT&limit=5'), 'Paper state returns JSON'));
  assert(paper.state?.position?.market_price > 0, 'Paper state marks to a live market price');
  assert(Array.isArray(paper.trades), 'Paper state returns trade history');

  const paperBotTests = unwrapPayload(await readJsonResponse(await apiRequest('/api/bud/paper-bot-test'), 'Paper bot runner returns JSON'));
  assert(Array.isArray(paperBotTests.sessions), 'Paper bot runner exposes paper sessions');
});

test('Legacy Thoon APIs are retired instead of pretending to work', async ({ apiRequest }) => {
  const retiredPaths = ['/api/agent/actions', '/api/alerts', '/api/backtests', '/api/bots', '/api/strategies'];

  for (const path of retiredPaths) {
    const response = await apiRequest(path, {
      body: JSON.stringify({ symbol: 'BTC/USDT' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const body = await response.text();

    assertStatus(response, 410, `${path} is retired`);
    assertIncludes(body, 'retired', `${path} explains retirement`);
    assertIncludes(body, '/api/bud', `${path} points to Bud APIs`);
  }
});

test('Source wiring points rebuilt pages to Bud and avoids client-side exchange secrets', async ({ readSource }) => {
  const budWorkspace = await readSource('src/screens/bud/BudWorkspacePage.tsx');
  assertIncludes(budWorkspace, '/api/bud/orchestrate', 'Agents use Bud orchestration route');
  assertIncludes(budWorkspace, '/api/bud/backtest', 'Backtest page uses Bud backtest route');
  assertIncludes(budWorkspace, '/api/bud/research', 'Strategies page uses Bud research route');
  assertIncludes(budWorkspace, '/api/bud/research/strategy', 'Strategies page can save edited Bud strategy versions');
  assertIncludes(budWorkspace, 'StrategyWorkbench', 'Strategies page exposes a selectable editable strategy workbench');
  assertIncludes(budWorkspace, 'Backtest edited', 'Strategies page can relaunch a backtest for edited parameters');
  assertIncludes(budWorkspace, 'Review note', 'Strategies page lets the user attach a manual evaluation note');
  assertIncludes(budWorkspace, '/api/bud/paper', 'Orders page uses Bud paper route');
  assertIncludes(budWorkspace, '/api/bud/paper-bot-test', 'Bots page can start a 2h paper bot test');
  assertIncludes(budWorkspace, '/api/bud/live-readiness', 'Bots and alerts use Bud readiness route');
  assertIncludes(budWorkspace, '/api/bud/hedge-fund-readiness', 'Strategies and bots use hedge fund readiness route');
  assertIncludes(budWorkspace, '/api/strategy-agents/deterministic', 'Strategies page uses deterministic non-LLM agents');
  assertIncludes(budWorkspace, 'Hedge Fund Readiness', 'Strategies and bots render hedge fund readiness status');

  const exchangeHub = await readSource('src/screens/ExchangeHubPage.tsx');
  assertIncludes(exchangeHub, '/api/wallets/readiness', 'Exchange hub checks wallet and DEX execution readiness');
  assertIncludes(exchangeHub, '/api/live-connectors/readiness', 'Exchange hub checks server-side Bud connector readiness');

  const liveConnectors = await readSource('src/server/live-connector-readiness.ts');
  assertIncludes(liveConnectors, 'BINANCE_API_KEY', 'Live readiness checks Binance server credentials');
  assertIncludes(liveConnectors, 'BYBIT_API_KEY', 'Live readiness checks Bybit server credentials');
  assertIncludes(liveConnectors, 'BITGET_API_PASSPHRASE', 'Live readiness checks Bitget passphrase');
  assertIncludes(liveConnectors, 'HYPERLIQUID_OFFICIAL_SIGNER_ENABLED', 'Live readiness keeps Hyperliquid signer explicit');
  assertIncludes(liveConnectors, 'DYDX_OFFICIAL_SIGNER_ENABLED', 'Live readiness keeps dYdX signer explicit');
  assertIncludes(liveConnectors, 'official_signer_not_enabled', 'DEX live signing remains blocked until the explicit signer env is enabled');
  assertIncludes(liveConnectors, 'Python SDK import', 'DEX signer readiness delegates SDK and permission verification to Bud');
  assert(!liveConnectors.includes('official_signer_code_not_implemented'), 'DEX live signing adapters are implemented instead of hard-coded as missing');

  const hyperliquidConnector = await readSource('backend/execution/hyperliquid_connector.py');
  assertIncludes(hyperliquidConnector, 'from hyperliquid.exchange import Exchange', 'Hyperliquid live signer uses the official SDK Exchange client');
  assertIncludes(hyperliquidConnector, 'Account.from_key', 'Hyperliquid live signer signs with the configured API wallet key');
  assertIncludes(hyperliquidConnector, 'cancel_by_cloid', 'Hyperliquid cancel can use deterministic CLOIDs');

  const dydxConnector = await readSource('backend/execution/dydx_connector.py');
  assertIncludes(dydxConnector, 'from dydx_v4_client.node.client import NodeClient', 'dYdX live signer uses the official NodeClient');
  assertIncludes(dydxConnector, 'sdk.TxOptions', 'dYdX live signer routes permissioned-key authenticators through TxOptions');
  assertIncludes(dydxConnector, 'node.place_order', 'dYdX live signer places orders through signed node transactions');

  const tradeRoute = await readSource('src/app/api/bud/trade/route.ts');
  assertIncludes(tradeRoute, 'getHedgeFundReadiness', 'Bud trade route gates automated live trading with hedge fund readiness');
  assertIncludes(tradeRoute, 'isAutomatedExecution', 'Bud trade route separates manual user live orders from orchestrated live orders');
  assertIncludes(tradeRoute, 'Manual live trading requires explicit user confirmation', 'Bud trade route keeps explicit confirmation on manual live orders');

  const strategyRoute = await readSource('src/app/api/bud/research/strategy/route.ts');
  assertIncludes(strategyRoute, 'registerBudResearchStrategy', 'Bud edited strategy route registers strategy versions server-side');
  assertIncludes(strategyRoute, 'thoon_edit_source', 'Bud edited strategy route marks Thoon user edits in metadata');

  const legacyTradingRoute = await readSource('src/app/api/[...path]/route.ts');
  assertIncludes(legacyTradingRoute, 'placeBudTrade', 'Legacy chart live execution routes through Bud when configured');
  assertIncludes(legacyTradingRoute, "liveExchangeProvider === 'bud'", 'Legacy chart live execution detects Bud as the live provider');
  assertIncludes(legacyTradingRoute, 'requiresHedgeFundReadinessForLiveExecution', 'Legacy chart live execution keeps hedge fund gates for orchestrated orders only');

  const chartsWorkspace = await readSource('src/screens/charts/ChartsWorkspace.tsx');
  assertIncludes(chartsWorkspace, '/api/bud/trade', 'Charts paper and live execution use Bud trade route');
  assert(!chartsWorkspace.includes('/api/trading/execute'), 'Charts no longer calls legacy trading execute route');
  assert(!chartsWorkspace.includes('/api/positions/'), 'Charts paper close no longer uses local position close route');

  const stateStrip = await readSource('src/components/bud/BudStateStrip.tsx');
  assertIncludes(stateStrip, '/api/bud/status', 'Global Bud strip reads Bud status');
  assertIncludes(stateStrip, '/api/bud/kill-switch', 'Global Bud strip reads kill-switch status');
  assert(!stateStrip.includes('API_SECRET'), 'Bud state strip does not expose exchange secrets');
  assert(!stateStrip.includes('PRIVATE_KEY'), 'Bud state strip does not expose wallet private keys');
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
    const nextMode = resolveNextMode();
    server = spawn(nextBin, [nextMode, '-H', '127.0.0.1', '-p', String(port)], {
      cwd: root,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        THOON_ADMIN_EMAIL: process.env.THOON_ADMIN_EMAIL ?? testAdminEmail,
        THOON_ADMIN_PASSWORD_HASH: process.env.THOON_ADMIN_PASSWORD_HASH ?? testAdminPasswordHash,
        THOON_AUTH_MODE: process.env.THOON_AUTH_MODE ?? 'local-disabled',
        THOON_AUTH_SESSION_SECRET: process.env.THOON_AUTH_SESSION_SECRET ?? 'functional-local-session-secret-minimum-32-characters',
        THOON_COOKIE_SECURE: process.env.THOON_COOKIE_SECURE ?? 'false',
        THOON_DATA_FILE: join(tempDataDir, 'thoon-db.json'),
      },
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
    const authCookie = await authCookieFor(baseUrl);
    const authedRequest = (path, init = {}) => fetch(`${baseUrl}${path}`, withAuth(init, authCookie));
    const context = {
      apiRequest: authedRequest,
      baseUrl,
      fetchPage: (path) => fetchPage(baseUrl, path, authCookie),
      rawRequest: (path, init = {}) => authedRequest(path, { ...init, redirect: 'manual' }),
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

  if (process.exitCode && serverOutput) {
    console.error(serverOutput);
  }
}

function test(name, run) {
  tests.push({ name, run });
}

async function fetchPage(baseUrl, path, authCookie = '') {
  const response = await fetch(`${baseUrl}${path}`, withAuth({}, authCookie));
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  return html;
}

async function authCookieFor(baseUrl) {
  const session = await fetch(`${baseUrl}/api/auth/session`);

  if (session.ok) {
    const body = await session.json().catch(() => null);

    if (body?.authenticated === true || body?.session?.mode === 'local-disabled') {
      return '';
    }
  }

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    body: JSON.stringify({ email: testAdminEmail, password: testAdminPassword }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const text = await login.text();

  if (!login.ok) {
    throw new Error(`Could not authenticate functional tests: ${login.status} ${text.slice(0, 300)}`);
  }

  const cookie = login.headers.get('set-cookie')?.split(';')[0];

  if (!cookie) {
    throw new Error('Functional test login did not return a session cookie.');
  }

  return cookie;
}

function withAuth(init = {}, authCookie = '') {
  if (!authCookie) {
    return init;
  }

  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      cookie: authCookie,
    },
  };
}

async function readSource(path) {
  return readFile(join(root, path), 'utf8');
}

function resolveNextMode() {
  if (process.env.THOON_TEST_NEXT_MODE === 'dev') {
    return 'dev';
  }

  if (process.env.THOON_TEST_NEXT_MODE === 'start' || existsSync(join(root, '.next', 'BUILD_ID'))) {
    return 'start';
  }

  return 'dev';
}

function unwrapPayload(value) {
  if (value && typeof value === 'object' && 'payload' in value) {
    return value.payload;
  }

  return value;
}

async function resetKillSwitch(apiRequest, detail) {
  const response = await apiRequest('/api/bud/kill-switch', {
    body: JSON.stringify({ action: 'reset', confirmation: 'RESET_KILL_SWITCH', detail, reason: 'manual' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const payload = unwrapPayload(await readJsonResponse(response, 'Kill switch reset returns JSON'));

  assertStatus(response, 200, 'Kill switch reset succeeds');

  return payload;
}

async function readJsonResponse(response, message) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${message}: response was not JSON: ${text.slice(0, 300)}`);
  }
}

function assertIncludes(value, expected, message) {
  if (!String(value).includes(expected)) {
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
  console.error(error);
  process.exit(1);
});
