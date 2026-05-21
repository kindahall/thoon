import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const nextBin = join(root, 'node_modules', '.bin', 'next');
const adminEmail = 'owner@thoon.local';
const adminPassword = 'staging-test-password-123!';
const adminPasswordHash = 'pbkdf2_sha256$310000$Twdd78pRmWT4GhMU97Pn9Q$J8NP6NufJ0J1HHUKwhoPvpa_pjJ7-qptRVzw5-FZcTM';

async function main() {
  if (!existsSync(nextBin)) {
    throw new Error('Next binary is missing. Run npm install first.');
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDataDir = await mkdtemp(join(tmpdir(), 'thoon-staging-'));
  const nextMode = resolveNextMode();
  let serverOutput = '';
  const server = spawn(nextBin, [nextMode, '-H', '127.0.0.1', '-p', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      THOON_ADMIN_EMAIL: adminEmail,
      THOON_ADMIN_PASSWORD_HASH: adminPasswordHash,
      THOON_APP_MODE: 'paper',
      THOON_AUTH_MODE: 'local-required',
      THOON_AUTH_SESSION_SECRET: 'staging-test-session-secret-minimum-32-characters',
      THOON_CRON_SECRET: 'staging-test-cron-secret-minimum-32-characters',
      THOON_EDGE_RATE_LIMIT_POLICY: 'configured',
      THOON_ENCRYPTION_KEY: 'staging-test-encryption-key-minimum-32-characters',
      THOON_LOGIN_RATE_LIMIT_MAX: '2',
      THOON_MARKET_DATA_PROVIDER: 'binance',
      THOON_MUTATION_RATE_LIMIT_MAX: '80',
      THOON_PRODUCTION_BASE_URL: baseUrl,
      THOON_RATE_LIMIT_ENABLED: 'true',
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
    await assertProtectedRedirect(baseUrl);
    await assertUnauthenticatedApiBlocked(baseUrl);
    await assertLoginRateLimit(baseUrl);
    const cookie = await login(baseUrl);
    await assertAuthenticatedApiContracts(baseUrl, cookie);
    console.log('OK staging auth, rate-limit, secrets and observability smoke');
  } catch (error) {
    if (serverOutput) {
      console.error(serverOutput);
    }

    throw error;
  } finally {
    server.kill('SIGTERM');
    setTimeout(() => {
      if (!server.killed) {
        server.kill('SIGKILL');
      }
    }, 1000).unref();
    await rm(tempDataDir, { force: true, recursive: true });
  }
}

async function assertProtectedRedirect(baseUrl) {
  const response = await fetch(`${baseUrl}/charts`, { redirect: 'manual' });
  assert([302, 303, 307, 308].includes(response.status), `Protected page should redirect, got ${response.status}`);
  assert(response.headers.get('location')?.includes('/login'), 'Protected page redirects to /login');
}

async function assertUnauthenticatedApiBlocked(baseUrl) {
  const response = await fetch(`${baseUrl}/api/markets`);
  const body = await response.text();

  assert(response.status === 401, `Unauthenticated API should return 401, got ${response.status}`);
  assert(body.includes('Authentication required'), 'Unauthenticated API explains auth requirement');

  for (const path of ['/api/health', '/api/observability/metrics']) {
    const protectedResponse = await fetch(`${baseUrl}${path}`);
    const protectedBody = await protectedResponse.text();

    assert(protectedResponse.status === 401, `${path} should require authentication, got ${protectedResponse.status}`);
    assert(protectedBody.includes('Authentication required'), `${path} explains auth requirement`);
  }
}

async function assertLoginRateLimit(baseUrl) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await postJson(baseUrl, '/api/auth/login', {
      email: 'attacker@example.invalid',
      password: 'wrong-password',
    });

    assert(response.status === 401, `Failed login attempt ${attempt + 1} should return 401, got ${response.status}`);
  }

  const blocked = await postJson(baseUrl, '/api/auth/login', {
    email: 'attacker@example.invalid',
    password: 'wrong-password',
  });
  const body = await blocked.text();

  assert(blocked.status === 429, `Repeated failed login should return 429, got ${blocked.status}`);
  assert(blocked.headers.get('retry-after'), 'Rate-limited login exposes Retry-After');
  assert(body.includes('Too many login attempts'), 'Rate-limited login explains the block');
}

async function login(baseUrl) {
  const response = await postJson(baseUrl, '/api/auth/login', {
    email: adminEmail,
    password: adminPassword,
  });

  assert(response.status === 200, `Admin login should return 200, got ${response.status}`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert(cookie?.startsWith('thoon_session='), 'Admin login sets a thoon_session cookie');

  return cookie;
}

async function assertAuthenticatedApiContracts(baseUrl, cookie) {
  const session = await getJson(baseUrl, '/api/auth/session', cookie);
  assert(session.authenticated === true, 'Authenticated session is visible');
  assert(session.session?.mode === 'authenticated', 'Session reports authenticated mode');

  const marketsResponse = await fetch(`${baseUrl}/api/markets`, { headers: { cookie } });
  assert(marketsResponse.status === 200, `Authenticated markets request should return 200, got ${marketsResponse.status}`);
  assert(marketsResponse.headers.get('x-thoon-request-id'), 'API responses expose request ids');

  const exchanges = await getJson(baseUrl, '/api/exchanges', cookie);
  const exchangeId = exchanges.exchanges?.[0]?.id;
  assert(exchangeId, 'Authenticated exchange list returns an exchange');

  const keyResponse = await postJson(
    baseUrl,
    '/api/exchanges/api-keys',
    {
      apiKey: 'staging-key-not-real',
      apiSecret: 'staging-secret-not-real',
      exchangeId,
      label: 'Staging smoke key',
      permissions: ['read'],
    },
    cookie,
  );
  const keyBody = await keyResponse.text();

  assert(keyResponse.status === 201, `API key storage should be allowed only in authenticated staging, got ${keyResponse.status}: ${keyBody}`);
  assert(!keyBody.includes('staging-secret-not-real'), 'API key response never leaks the raw secret');

  const keyTestResponse = await postJson(baseUrl, '/api/exchanges/test', { exchangeId }, cookie);
  const keyTest = await keyTestResponse.json();

  assert(keyTest.liveNetworkChecked === false, 'API key test does not pretend a live network check happened');
  assert(keyTest.activatedKeys === 0, 'API key test does not activate testing keys without a signed live check');

  const malformedJson = await fetch(`${baseUrl}/api/risk-rules`, {
    body: '{"maxRiskPerTrade":',
    headers: { 'content-type': 'application/json', cookie },
    method: 'PATCH',
  });
  const malformedJsonBody = await malformedJson.text();

  assert(malformedJson.status === 400, `Malformed JSON should return 400, got ${malformedJson.status}`);
  assert(malformedJsonBody.includes('Malformed JSON'), 'Malformed JSON response explains the parse failure');

  const metrics = await getJson(baseUrl, '/api/observability/metrics', cookie);
  assert(metrics.counters?.apiRequests > 0, 'Metrics count API requests');
  assert(metrics.counters?.authFailures >= 2, 'Metrics count auth failures');
  assert(metrics.counters?.rateLimitedRequests >= 1, 'Metrics count rate-limited requests');
  assert(metrics.apiLatencyBuckets, 'Metrics expose latency buckets');

  const readinessResponse = await fetch(`${baseUrl}/api/production/readiness`, { headers: { cookie } });
  const readiness = await readinessResponse.json();
  const runtimeRateLimit = readiness.checks?.find((check) => check.id === 'runtime-rate-limit');
  const edgeRateLimit = readiness.checks?.find((check) => check.id === 'edge-rate-limit');
  const agentCronSecret = readiness.checks?.find((check) => check.id === 'agent-cron-secret');

  assert(runtimeRateLimit?.ok === true, 'Readiness confirms runtime rate limits');
  assert(edgeRateLimit?.ok === true, 'Readiness confirms edge rate-limit policy acknowledgement');
  assert(agentCronSecret?.ok === true, 'Readiness confirms agent cron secret protection');

  for (const path of ['/api/agent/cron', '/api/agent/progress', '/api/agent/actions']) {
    const retired = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
    const retiredBody = await retired.text();

    assert(retired.status === 410, `${path} should be retired in Thoon/Bud, got ${retired.status}`);
    assert(retiredBody.includes('/api/bud'), `${path} should point callers to Bud APIs`);
  }

  const budStatus = await fetch(`${baseUrl}/api/bud/status`, { headers: { cookie } });
  const budStatusBody = await budStatus.text();
  assert(budStatus.status === 200, `Bud status should be reachable in authenticated staging, got ${budStatus.status}: ${budStatusBody.slice(0, 300)}`);
  assert(budStatusBody.includes('thoon_bud_backend'), 'Bud status reports the Bud backend source');
}

async function postJson(baseUrl, path, body, cookie) {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    method: 'POST',
  });
}

async function getJson(baseUrl, path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  const body = await response.text();

  assert(response.ok, `${path} should return 2xx, got ${response.status}: ${body}`);

  return JSON.parse(body);
}

async function waitForServer(baseUrl, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/login`);

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

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
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
