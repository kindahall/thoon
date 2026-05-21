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
    {
      id: 'runtime-rate-limit',
      ok: env.rateLimitEnabled && env.loginRateLimitMax > 0 && env.mutationRateLimitMax > 0,
      message: env.rateLimitEnabled ? 'Runtime API rate limits enabled.' : 'Keep THOON_RATE_LIMIT_ENABLED enabled in production.',
    },
    {
      id: 'trusted-proxy-headers',
      ok: env.trustProxyHeaders || env.nodeEnv !== 'production',
      message: env.trustProxyHeaders || env.nodeEnv !== 'production' ? 'Client IP headers are trusted only in an approved proxy environment.' : 'Set THOON_TRUST_PROXY_HEADERS=true only after the app is behind a trusted proxy/CDN.',
    },
    {
      id: 'edge-rate-limit',
      ok: env.edgeRateLimitPolicy === 'configured' || env.nodeEnv !== 'production',
      message: env.edgeRateLimitPolicy === 'configured' || env.nodeEnv !== 'production' ? 'Edge/WAF rate-limit policy acknowledged.' : 'Set THOON_EDGE_RATE_LIMIT_POLICY=configured after enabling host/WAF throttling.',
    },
    {
      id: 'agent-cron-secret',
      ok: Boolean(env.cronSecret) || env.nodeEnv !== 'production',
      message: env.cronSecret || env.nodeEnv !== 'production' ? 'Agent cron endpoint is protected or running locally.' : 'Set THOON_CRON_SECRET before enabling scheduled agent runs.',
    },
    {
      id: 'audit-retention',
      ok: env.auditMaxEvents >= 500 && env.auditRetentionDays >= 30,
      message: env.auditMaxEvents >= 500 && env.auditRetentionDays >= 30 ? 'Audit retention is configured.' : 'Set THOON_AUDIT_MAX_EVENTS and THOON_AUDIT_RETENTION_DAYS for incident review.',
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
