import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type JsonRecord = Record<string, unknown>;

const e2eAdminEmail = 'e2e-owner@thoon.local';
const e2eAdminPassword = 'e2e-admin-password-123';

const primaryRoutes = [
  { route: '/charts?pair=BTC%2FUSDT', title: 'Cockpit trading' },
  { route: '/markets', title: 'Markets' },
  { route: '/watchlist', title: 'Watchlist' },
  { route: '/agents', title: 'Agents' },
  { route: '/backtest', title: 'Backtest' },
  { route: '/strategies', title: 'Strategies' },
  { route: '/bots', title: 'Bots' },
  { route: '/orders', title: 'Orders' },
  { route: '/alerts', title: 'Alerts' },
  { route: '/history', title: 'History' },
  { route: '/exchanges', title: 'Exchange & API' },
  { route: '/preferences', title: 'Preferences' },
  { route: '/preferences/profile', title: 'Profile' },
  { route: '/preferences/appearance', title: 'Appearance' },
  { route: '/preferences/trading-defaults', title: 'Trading Defaults' },
  { route: '/preferences/security', title: 'Security' },
  { route: '/preferences/data-privacy', title: 'Data' },
  { route: '/preferences/risk-rules', title: 'Risk Rules' },
  { route: '/preferences/trade-limits', title: 'Trade Limits' },
  { route: '/preferences/audit-logs', title: 'Audit Logs' },
];

const navLinks = [
  { label: 'Charts', path: '/charts' },
  { label: 'Markets', path: '/markets' },
  { label: 'Watchlist', path: '/watchlist' },
  { label: 'Agents', path: '/agents' },
  { label: 'Backtest', path: '/backtest' },
  { label: 'Strategies', path: '/strategies' },
  { label: 'Bots', path: '/bots' },
  { label: 'Orders', path: '/orders' },
  { label: 'Alerts', path: '/alerts' },
  { label: 'History', path: '/history' },
  { label: 'Exchanges', path: '/exchanges' },
  { label: 'Preferences', path: '/preferences' },
];

test.beforeEach(async ({ request }) => {
  await ensureAuthenticatedIfNeeded(request);
});

test('every visible Thoon/Bud page settles without blocking runtime states', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  for (const item of primaryRoutes) {
    await gotoAuthenticated(page, item.route);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('main h1')).toContainText(item.title, { timeout: 20_000 });
    await expect(page.locator('.bud-state-strip')).toContainText('Bud online', { timeout: 35_000 });
    await assertNoBlockingState(page);
  }

  expect(pageErrors).toEqual([]);
});

test('sidebar navigation links all open live pages', async ({ page }) => {
  await gotoAuthenticated(page, '/charts');

  for (const link of navLinks) {
    const nav = page.getByRole('complementary', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: link.label })).toBeVisible();
    await nav.getByRole('link', { name: link.label }).click();
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(link.path)}(?:[/?#].*)?$`), { timeout: 20_000 });
    await expect(page.locator('.bud-state-strip')).toContainText('Bud online', { timeout: 35_000 });
    await assertNoBlockingState(page);
  }
});

test('Bud workspace safe actions finish and render structured results', async ({ page }) => {
  await gotoAuthenticated(page, '/agents');
  await clickAndExpect(page, 'Macro', 'macro_regime', 120_000);
  await clickAndExpect(page, 'Portfolio', 'weights', 120_000);
  await clickAndExpect(page, 'Arbitrage', 'arbitrage_opportunities', 120_000);

  await gotoAuthenticated(page, '/strategies');
  await clickAndExpect(page, 'Load registry', 'Strategies', 45_000);
  await clickAndExpect(page, 'Backtest current', 'walk_forward', 120_000);

  await gotoAuthenticated(page, '/bots');
  await clickAndExpect(page, 'Check readiness', 'live_trading_disabled', 60_000);
  await clickAndExpect(page, 'Refresh positions', 'Execution Positions', 45_000);

  await gotoAuthenticated(page, '/alerts');
  await clickAndExpect(page, 'Run checks', 'live_trading_disabled', 60_000);
  await clickAndExpect(page, 'Kill status', 'Kill Switch', 45_000);

  await gotoAuthenticated(page, '/orders');
  await clickAndExpect(page, 'Refresh', 'Risk Limits', 45_000);
});

test('Bud API surface returns controlled JSON for every backend module', async ({ request }) => {
  await expectBudGet(request, '/api/bud/status', ['status', 'health', 'capabilities']);
  await expectBudGet(request, '/api/bud/process', ['running', 'status']);
  await expectBudGet(request, '/api/bud/kill-switch', ['active']);
  await expectBudGet(request, '/api/bud/execution?mode=paper&symbol=BTCUSDT', ['capabilities', 'positions']);
  await expectBudGet(request, '/api/bud/paper?symbol=BTCUSDT&limit=10', ['state', 'trades', 'riskLimits']);
  await expectBudGet(request, '/api/bud/research?limit=10', ['runs', 'strategies', 'evaluations']);
  await expectBudGet(request, '/api/bud/live-readiness', ['live_ready', 'blockers', 'safety_score']);
  await expectBudGet(request, '/api/bud/hedge-fund-readiness', ['status', 'score', 'gates', 'summary', 'blockers']);

  await expectBudPost(request, '/api/bud/backtest', { interval: '1h', limit: 240, symbol: 'BTCUSDT' }, ['symbol', 'metrics', 'walk_forward']);
  await expectBudPost(request, '/api/bud/macro', { crypto_lookback: 240, interval: '1h', macro_lookback_days: 120, symbols: ['BTCUSDT', 'ETHUSDT'] }, ['macro_regime', 'correlations', 'allocation']);
  await expectBudPost(request, '/api/bud/portfolio', { interval: '1h', lookback: 240, symbols: ['BTCUSDT', 'ETHUSDT', 'ONDOUSDT'] }, ['weights', 'expected_return', 'expected_risk']);
  await expectBudPost(request, '/api/bud/arbitrage', { max_opportunities: 4, symbols: ['BTCUSDT', 'ETHUSDT'], target_notional: 250 }, ['arbitrage_opportunities', 'expected_profit', 'execution_feasibility']);
});

async function clickAndExpect(page: Page, buttonName: string, expectedText: string | RegExp, timeout: number) {
  const button = page.getByRole('button', { name: buttonName });
  await expect(button.first()).toBeVisible({ timeout: 20_000 });
  await expect(button.first()).toBeEnabled({ timeout: 20_000 });
  await button.first().click();
  await waitForSettledButtons(page, timeout);
  await expect(page.locator('body')).toContainText(expectedText, { timeout });
  await assertNoBlockingState(page);
}

async function expectBudGet(request: APIRequestContext, path: string, keys: string[]) {
  const response = await request.get(path, { timeout: 120_000 });
  await expect(response, `${path} should return JSON`).toBeOK();
  const payload = unwrapPayload(await response.json());

  for (const key of keys) {
    expect(payload, `${path} should include ${key}`).toHaveProperty(key);
  }
}

async function expectBudPost(request: APIRequestContext, path: string, data: JsonRecord, keys: string[]) {
  const response = await request.post(path, { data, timeout: 120_000 });
  await expect(response, `${path} should return JSON`).toBeOK();
  const payload = unwrapPayload(await response.json());

  for (const key of keys) {
    expect(payload, `${path} should include ${key}`).toHaveProperty(key);
  }
}

async function assertNoBlockingState(page: Page) {
  await waitForSettledButtons(page, 35_000);
  await expect(page.getByRole('heading', { name: 'Unlock Thoon' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error|Unhandled Runtime Error|Authentication required/i);
  await expect(page.locator('.tradingview-chart__state--loading')).toHaveCount(0, { timeout: 12_000 });
  await expect(page.locator('.bud-state-strip')).not.toContainText('Bud offline');
}

async function waitForSettledButtons(page: Page, timeout: number) {
  await expect(page.getByRole('button', { name: /loading/i })).toHaveCount(0, { timeout });
}

async function ensureAuthenticatedIfNeeded(request: APIRequestContext) {
  const session = await request.get('/api/auth/session');

  if (session.ok()) {
    const body = await session.json().catch(() => null);

    if (body?.authenticated === true || body?.session?.mode === 'local-disabled') {
      return;
    }
  }

  const login = await request.post('/api/auth/login', {
    data: {
      email: e2eAdminEmail,
      password: e2eAdminPassword,
    },
  });

  await expect(login).toBeOK();
}

async function gotoAuthenticated(page: Page, route: string) {
  await page.goto(route);

  if ((await page.getByRole('heading', { name: 'Unlock Thoon' }).count()) === 0) {
    return;
  }

  await page.getByLabel('Email').fill(e2eAdminEmail);
  await page.getByLabel('Password').fill(e2eAdminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock Thoon' })).toHaveCount(0, { timeout: 15_000 });

  if (!page.url().includes(route.split('?')[0])) {
    await page.goto(route);
  }
}

function unwrapPayload(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    return {};
  }

  return isRecord(value.payload) ? value.payload : value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
