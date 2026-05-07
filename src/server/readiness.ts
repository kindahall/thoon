import { getAuthProductionStatus } from './auth';
import { getThoonServerEnv, hasProductionEncryptionKey } from './env';
import { checkPostgresReadiness } from './postgres-store';

export async function getProductionReadiness() {
  const env = getThoonServerEnv();
  const auth = getAuthProductionStatus();
  const postgres = await checkPostgresReadiness();
  const checks = [
    {
      id: 'auth-required',
      ok: env.authMode === 'local-required',
      message: env.authMode === 'local-required' ? 'Auth required for production mutations.' : 'Set THOON_AUTH_MODE=local-required before production.',
    },
    {
      id: 'admin-password',
      ok: auth.hasAdminPasswordHash,
      message: auth.hasAdminPasswordHash ? 'Admin password hash configured.' : 'Set THOON_ADMIN_PASSWORD_HASH with npm run auth:hash.',
    },
    {
      id: 'session-secret',
      ok: auth.hasProductionSessionSecret,
      message: auth.hasProductionSessionSecret ? 'Session secret configured.' : 'Set THOON_AUTH_SESSION_SECRET to a unique 32+ character secret.',
    },
    {
      id: 'encryption-key',
      ok: hasProductionEncryptionKey(env.encryptionKey),
      message: hasProductionEncryptionKey(env.encryptionKey) ? 'Exchange secret encryption key configured.' : 'Set THOON_ENCRYPTION_KEY before saving live API keys.',
    },
    {
      id: 'postgres',
      ok: postgres.ok && postgres.configured,
      message: postgres.ok && postgres.configured ? 'Postgres migrations reachable.' : postgres.error ?? 'Set THOON_DATABASE_PROVIDER=postgres and DATABASE_URL, then run npm run db:migrate.',
    },
    {
      id: 'live-exchange',
      ok: env.appMode !== 'live-enabled' || env.liveExchangeProvider !== 'disabled',
      message: env.appMode !== 'live-enabled' || env.liveExchangeProvider !== 'disabled' ? 'Live exchange provider configured for current app mode.' : 'Set THOON_LIVE_EXCHANGE_PROVIDER before THOON_APP_MODE=live-enabled.',
    },
    {
      id: 'production-url',
      ok: Boolean(env.productionBaseUrl) || env.nodeEnv !== 'production',
      message: env.productionBaseUrl || env.nodeEnv !== 'production' ? 'Production URL context available or not required locally.' : 'Set THOON_PRODUCTION_BASE_URL.',
    },
  ];

  return {
    appMode: env.appMode,
    auth,
    checks,
    database: postgres,
    ok: checks.every((check) => check.ok),
    release: env.release,
    timestamp: new Date().toISOString(),
  };
}
