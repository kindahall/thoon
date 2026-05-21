# Thoon Production Readiness

## Runtime Gates

Use `/api/production/readiness` before deploying live execution. It fails until these are configured:

- `THOON_AUTH_MODE=local-required`
- `THOON_ADMIN_PASSWORD_HASH`
- `THOON_AUTH_SESSION_SECRET`
- `THOON_ENCRYPTION_KEY`
- `THOON_DATABASE_PROVIDER=postgres`
- `DATABASE_URL`
- `THOON_LIVE_EXCHANGE_PROVIDER=binance` before `THOON_APP_MODE=live-enabled`
- `THOON_RATE_LIMIT_ENABLED=true`
- `THOON_TRUST_PROXY_HEADERS=true` only after deployment behind a trusted proxy/CDN
- `THOON_EDGE_RATE_LIMIT_POLICY=configured` after host/WAF throttling is enabled
- `THOON_CRON_SECRET` before scheduled Strategy Agent runs are enabled
- audit retention values large enough for incident review

## Commands

```bash
npm run auth:hash -- "replace-with-a-long-password"
npm run db:migrate
npm run db:push
npm run saas:bootstrap
npm run verify
```

`npm run db:push` creates the `thoon_app_state/default` snapshot required by readiness. When `THOON_DATABASE_PROVIDER=postgres`, API mutations wait for the Postgres mirror before returning, so a failed durable write fails the request instead of being hidden.

When `THOON_SAAS_MODE=enabled`, `npm run saas:bootstrap` migrates the existing snapshot into the first owner workspace and stores a JSONB backup in `thoon_app_state_backups`. Paid SaaS billing also requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the Pro/Elite monthly/yearly Stripe Price IDs before Checkout or webhooks can be used.

## Strategy Agent

- `THOON_AGENT_AI_PROVIDER=codex` runs Thoonix through the local Codex CLI logged into the machine's ChatGPT/Codex plan; no OpenAI API key is required for that mode.
- Thoonix keeps chat responsive by using compact context for simple messages and full context only for strategy, market, TradingView, bot, risk and paper-test requests.
- `THOON_AGENT_AI_PROVIDER=openai` or `openai-compatible` can call a remote model from the server only.
- `THOON_AGENT_AI_API_KEY` is only for remote OpenAI-compatible providers and must never be exposed in client code.
- TradingView MCP is expected under Codex MCP server name `tradingview`. Check it with `codex mcp list`; Thoonix uses it only for symbol/chart/TA research and public strategy concept import before Thoon backtests and paper-tests the result.
- Strategy research can be aggressive; live launch, live orders, API key changes and Risk Rules edits remain blocked outside explicit production flows.
- `/api/agent/cron` is scheduled every 5 minutes by `vercel.json` to research, innovate and run strict live-candle validation batches.
- `/api/agent/progress` is scheduled every 30 minutes by `vercel.json` to write compact strategy feedback reports.
- Both scheduled agent endpoints only accept bearer authorization when `THOON_CRON_SECRET` is configured.

## Live Execution

Live orders stay blocked unless:

- `THOON_APP_MODE=live-enabled`
- `THOON_LIVE_EXCHANGE_PROVIDER=binance`
- a trade-enabled Binance API key is saved through Preferences -> Exchange & API
- the key has been tested and promoted to `active`
- withdrawals remain disabled on the exchange side
- Risk Engine allows the order

`THOON_LIVE_ORDER_ENDPOINT=test` calls Binance's signed test endpoint. Switch to `live` only after a small controlled production verification.

## Monitoring

- `/api/health` exposes runtime provider and resource contracts.
- `/api/production/readiness` must be green before live deployment.
- `/api/observability/metrics` exposes in-process counters, status counts, latency buckets, auth failures, rate-limit blocks, risk blocks and live order routing.
- Every API response includes `X-Thoon-Request-Id` and `X-Thoon-Release` for log correlation.
- Audit events are mirrored into structured server logs and retained according to `THOON_AUDIT_MAX_EVENTS` and `THOON_AUDIT_RETENTION_DAYS`.
- `.github/workflows/ci.yml` runs npm audit, lint, typecheck, build, functional tests, staging smoke and Playwright E2E on pull requests and main.

## Staging Smoke

`npm run test:staging` starts Thoon with `THOON_AUTH_MODE=local-required`, strong staging-only secrets, runtime rate limiting and Binance public market data. It verifies:

- protected pages redirect to login;
- unauthenticated API calls return 401;
- repeated failed logins return 429 with `Retry-After`;
- authenticated API calls receive request ids;
- exchange API-key storage is allowed only behind authenticated staging and never leaks raw secrets;
- observability counts auth failures and rate-limit blocks;
- scheduled Strategy Agent cron rejects cookie-only calls and accepts the configured bearer secret.
