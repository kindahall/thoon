import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type JsonRecord = Record<string, unknown>;

const rebuiltRoutes = [
  '/charts?pair=BTC%2FUSDT',
  '/markets',
  '/watchlist',
  '/agents',
  '/agent',
  '/backtest',
  '/strategies',
  '/bots',
  '/orders',
  '/alerts',
  '/history',
  '/exchanges',
  '/preferences',
];

const removedRoutes = ['/strategies/new', '/strategies/core-lab', '/bots/new', '/backtest/replay', '/top-strategies'];
const e2eAdminEmail = 'e2e-owner@thoon.local';
const e2eAdminPassword = 'e2e-admin-password-123';

test.beforeEach(async ({ request }) => {
  await ensureAuthenticatedIfNeeded(request);
  await resetKillSwitch(request);
});

test('rebuilt Thoon/Bud routes render with global Bud state', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  for (const route of rebuiltRoutes) {
    await gotoAuthenticated(page, route);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.bud-state-strip')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unlock Thoon' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error|Unhandled Runtime Error/);
    await expect(page.locator('.bud-state-strip')).toContainText(/Bud|Binance|Paper|Live/i);
  }

  expect(pageErrors).toEqual([]);
});

test('retired legacy routes remain removed', async ({ request }) => {
  for (const route of removedRoutes) {
    const response = await request.get(route);
    expect(response.status(), `${route} should stay removed`).toBe(404);
  }
});

test('TradingView ONDO chart clears the loading overlay', async ({ page }) => {
  await gotoAuthenticated(page, '/charts');
  const marketPair = page.getByLabel('Market pair');
  await marketPair.selectOption('ONDO/USDT');
  await expect(marketPair).toHaveValue('ONDO/USDT');

  const tradingViewButton = page.getByRole('button', { name: 'TradingView' });
  await tradingViewButton.click();
  await expect(tradingViewButton).toHaveClass(/is-active/);

  await expect(page.locator('.tradingview-chart__iframe')).toHaveAttribute('title', /ONDOUSDT/);
  await expect(page.locator('.tradingview-chart')).toHaveClass(/tradingview-chart--ready/, { timeout: 10_000 });
  await expect(page.locator('.tradingview-chart__state--loading')).toHaveCount(0);
});

test('Bud backend API exposes live status, real Binance backtest and safety gates', async ({ request }) => {
  const statusResponse = await request.get('/api/bud/status');
  await expect(statusResponse).toBeOK();
  const status = await statusResponse.json();

  expect(status.source).toBe('thoon_bud_backend');
  expect(status.status).toBe('online');
  expect(status.health.status).toBe('ok');
  expect(status.health.binance_rest).toBe('ok');
  expect(status.capabilities.supported_exchanges).toEqual(expect.arrayContaining(['binance', 'bybit', 'bitget', 'hyperliquid', 'dydx']));
  expect(status.capabilities.default_mode).toBe('paper');
  expect(status.capabilities.live_trading_enabled).toBe(false);

  const backtestResponse = await request.post('/api/bud/backtest', {
    data: {
      interval: '1h',
      limit: 240,
      symbol: 'BTCUSDT',
      validate_data_quality: true,
      walk_forward_validate: true,
    },
  });
  await expect(backtestResponse).toBeOK();
  const backtest = unwrapPayload(await backtestResponse.json());
  const dataQuality = asRecord(backtest.data_quality);
  const metrics = asRecord(backtest.metrics);
  const walkForward = asRecord(backtest.walk_forward);
  const transactionCosts = asRecord(backtest.transaction_costs);

  expect(backtest.symbol).toBe('BTCUSDT');
  expect(backtest.rows).toBeGreaterThanOrEqual(240);
  expect(dataQuality.exchange).toBe('binance');
  expect(dataQuality.usable_for_backtest).toBe(true);
  expect(typeof metrics.total_return).toBe('number');
  expect(metrics).toHaveProperty('sharpe_ratio');
  expect(metrics).toHaveProperty('max_drawdown');
  expect(Array.isArray(walkForward.fold_results)).toBe(true);
  expect(String(transactionCosts.orderbook_source)).toContain('binance');

  const readinessResponse = await request.get('/api/bud/live-readiness');
  await expect(readinessResponse).toBeOK();
  const readiness = unwrapPayload(await readinessResponse.json());
  const blockers = asArray(readiness.blockers);

  expect(readiness.live_ready).toBe(false);
  expect(blockers.length).toBeGreaterThan(0);
  expect(blockers.join(' ')).toContain('live_trading_disabled');

  const blockedLivePaper = await request.post('/api/bud/paper', {
    data: { liveTrading: true, quantity: 0.0001, side: 'buy', symbol: 'BTCUSDT' },
  });
  expect(blockedLivePaper.status()).toBe(403);
  await expect(blockedLivePaper).not.toBeOK();

  const resetKillSwitchResponse = await request.post('/api/bud/kill-switch', {
    data: { action: 'reset', confirmation: 'RESET_KILL_SWITCH' },
    timeout: 120_000,
  });
  await expect(resetKillSwitchResponse).toBeOK();

  const unconfirmedManualLive = await request.post('/api/bud/trade', {
    data: { exchange: 'binance', live_trading: true, paper_trading: false, quantity: 0.0001, side: 'buy', symbol: 'BTCUSDT' },
  });
  expect(unconfirmedManualLive.status()).toBe(428);
  await expect(unconfirmedManualLive).not.toBeOK();

  const confirmedManualLive = await request.post('/api/bud/trade', {
    data: { confirmed: true, exchange: 'binance', execution_source: 'manual', live_trading: true, paper_trading: false, quantity: 0.0001, side: 'buy', symbol: 'BTCUSDT' },
    timeout: 120_000,
  });
  const confirmedManualLiveText = await confirmedManualLive.text();
  expect(confirmedManualLive.status()).toBe(403);
  expect(confirmedManualLiveText).toContain('live trading is disabled');
  expect(confirmedManualLiveText).not.toContain('hedge fund readiness');

  const orchestratedLive = await request.post('/api/bud/trade', {
    data: { confirmed: true, exchange: 'binance', execution_source: 'orchestrator', live_trading: true, paper_trading: false, quantity: 0.0001, side: 'buy', symbol: 'BTCUSDT' },
    timeout: 120_000,
  });
  const orchestratedLiveText = await orchestratedLive.text();
  expect(orchestratedLive.status()).toBe(403);
  expect(orchestratedLiveText).toContain('hedge fund readiness');
});

test('backtest page can run a real Bud backtest from the UI', async ({ page }) => {
  await gotoAuthenticated(page, '/backtest');
  await expect(page.locator('.bud-state-strip')).toBeVisible();
  await page.getByRole('button', { name: 'Run backtest' }).click();

  await expect(page.locator('body')).toContainText('BTCUSDT', { timeout: 90_000 });
  await expect(page.locator('body')).toContainText('sharpe_ratio', { timeout: 90_000 });
  await expect(page.locator('body')).toContainText('walk_forward', { timeout: 90_000 });
});

test('orders page can place a tiny paper trade using a real market price', async ({ page }) => {
  await gotoAuthenticated(page, '/orders');
  await expect(page.locator('.bud-state-strip')).toBeVisible();
  await fillQuantity(page, '0.0001');
  await page.getByRole('button', { name: 'Paper buy' }).click();

  await expect(page.locator('body')).toContainText(/Market Price|market_price/i, { timeout: 60_000 });
  await expect(page.locator('body')).toContainText(/Paper Trades|trades/i, { timeout: 60_000 });
});

test('legacy API writes return 410 instead of fake success', async ({ request }) => {
  for (const path of ['/api/agent/actions', '/api/alerts', '/api/backtests', '/api/bots', '/api/strategies']) {
    const response = await request.post(path, { data: { symbol: 'BTC/USDT' } });
    const body = await response.text();

    expect(response.status(), `${path} should be retired`).toBe(410);
    expect(body).toContain('retired');
    expect(body).toContain('/api/bud');
  }
});

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

async function resetKillSwitch(request: APIRequestContext) {
  const response = await request.post('/api/bud/kill-switch', {
    data: {
      action: 'reset',
      confirmation: 'RESET_KILL_SWITCH',
      detail: 'Playwright smoke setup',
      reason: 'manual',
    },
    timeout: 30_000,
  });

  await expect(response).toBeOK();
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

async function fillQuantity(page: Page, value: string) {
  const spinbuttons = page.getByRole('spinbutton');
  const count = await spinbuttons.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const input = spinbuttons.nth(index);
    const label = await input.getAttribute('aria-label').catch(() => '');
    const currentValue = await input.inputValue().catch(() => '');

    if (label === 'Quantity' || currentValue === '0.001') {
      await input.fill(value);
      return;
    }
  }

  await spinbuttons.first().fill(value);
}

function unwrapPayload(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    return {};
  }

  return isRecord(value.payload) ? value.payload : value;
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
