import { expect, test, type Locator, type Page } from '@playwright/test';

const routes = [
  '/charts?pair=BTC%2FUSDT',
  '/markets',
  '/watchlist',
  '/exchanges',
  '/orders',
  '/alerts',
  '/history',
  '/preferences',
  '/preferences/appearance',
  '/preferences/risk-rules',
  '/agent',
  '/strategies',
  '/strategies/new',
  '/bots',
  '/bots/new',
  '/backtest',
  '/backtest/replay',
];

const unsafeButtonPattern =
  /archive|cancel|clear|close all|confirm live|delete|duplicate|execute|export|launch|live|logout|remove|reset|revoke|run backtest|send test|start|stop|pause/i;

test('primary routes render and safe buttons respond', async ({ page }) => {
  const pageErrors: string[] = [];
  let totalButtons = 0;
  let totalSafeClicks = 0;

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error|Unhandled Runtime Error/);

    if (route.startsWith('/charts')) {
      await expect(page.locator('.chart-indicator-readout').first()).toBeVisible();
      await expect(page.locator('.chart-indicator-readout').first()).not.toContainText(/L\s+\$0(?:\.00)?\b/);
    }

    const buttons = await page.locator('button:visible').all();
    totalButtons += buttons.length;

    let routeClicks = 0;
    for (const button of buttons) {
      if (routeClicks >= 3) {
        break;
      }

      if (!(await button.isEnabled().catch(() => false))) {
        continue;
      }

      const label = await buttonLabel(button);

      if (!label || unsafeButtonPattern.test(label)) {
        continue;
      }

      await button.scrollIntoViewIfNeeded();
      await button.click({ timeout: 2500 });
      await closeTransientSurfaces(page);
      await page.waitForTimeout(40);
      routeClicks += 1;
      totalSafeClicks += 1;
    }
  }

  expect(totalButtons).toBeGreaterThan(100);
  expect(totalSafeClicks).toBeGreaterThan(35);
  expect(pageErrors).toEqual([]);
});

test('core authenticated API contracts remain reachable in test mode', async ({ request }) => {
  const health = await request.get('/api/health');
  await expect(health).toBeOK();
  expect(health.headers()['x-thoon-request-id']).toBeTruthy();

  const metrics = await request.get('/api/observability/metrics');
  await expect(metrics).toBeOK();
  const metricsBody = await metrics.json();

  expect(metricsBody.counters.apiRequests).toBeGreaterThan(0);
  expect(metricsBody.apiLatencyBuckets).toBeTruthy();

  const blockedOrigin = await request.post('/api/alerts', {
    data: { symbol: 'BTC/USDT' },
    headers: { origin: 'https://example.invalid' },
  });
  expect(blockedOrigin.status()).toBe(403);
});

test('agent chat sends with Enter and keeps Shift Enter for new lines', async ({ page }) => {
  const message = `Entrée envoie le chat ${Date.now()}`;
  let postedMessage = '';
  let pollCount = 0;

  await page.route('**/api/agent/chat', async (route) => {
    if (route.request().method() === 'GET') {
      pollCount += 1;
      await route.fulfill({
        body: JSON.stringify([
          { content: 'Analyse profonde terminee.', createdAt: new Date().toISOString(), id: 'test-agent-deep', role: 'assistant', status: 'completed' },
          { content: postedMessage, createdAt: new Date().toISOString(), id: 'test-user-message', role: 'user', status: 'completed' },
        ]),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    const payload = JSON.parse(route.request().postData() ?? '{}') as { message?: string };
    postedMessage = payload.message ?? '';
    await route.fulfill({
      body: JSON.stringify({
        messages: [
          { content: 'Analyse profonde lancee avec Codex.', createdAt: new Date().toISOString(), id: 'test-agent-deep', role: 'assistant', status: 'running' },
          { content: 'Reponse instantanee.', createdAt: new Date().toISOString(), id: 'test-agent-instant', role: 'assistant', status: 'completed' },
          { content: postedMessage, createdAt: new Date().toISOString(), id: 'test-user-message', role: 'user', status: 'completed' },
        ],
        reply: { content: 'Reponse instantanee.', createdAt: new Date().toISOString(), id: 'test-agent-instant', role: 'assistant', status: 'completed' },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/agent');
  const textarea = page.locator('.codex-chat-form textarea');
  await textarea.fill('ligne 1');
  await textarea.press('Shift+Enter');
  await expect(textarea).toHaveValue('ligne 1\n');

  await textarea.fill(message);
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/agent/chat') && response.request().method() === 'POST');
  await textarea.press('Enter');
  await responsePromise;

  expect(postedMessage).toBe(message);
  await expect(textarea).toHaveValue('');
  await expect(page.locator('.codex-chat-thread')).toContainText(message);
  await expect(page.locator('.codex-chat-thread')).toContainText('Analyse profonde terminee.');
  expect(pollCount).toBeGreaterThan(0);
});

async function buttonLabel(button: Locator) {
  const text = await button.innerText().catch(() => '');
  const aria = await button.getAttribute('aria-label').catch(() => '');
  const title = await button.getAttribute('title').catch(() => '');

  return `${text} ${aria ?? ''} ${title ?? ''}`.replace(/\s+/g, ' ').trim();
}

async function closeTransientSurfaces(page: Page) {
  const closeButton = page.locator('.ui-modal button[aria-label="Close"]:visible').first();

  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    return;
  }

  await page.keyboard.press('Escape').catch(() => undefined);
}
