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

## Commands

```bash
npm run auth:hash -- "replace-with-a-long-password"
npm run db:migrate
npm run db:push
npm run lint
npm run typecheck
npm run build
npm run test
```

`npm run db:push` creates the `thoon_app_state/default` snapshot required by readiness. When `THOON_DATABASE_PROVIDER=postgres`, API mutations wait for the Postgres mirror before returning, so a failed durable write fails the request instead of being hidden.

## Strategy Agent

- `THOON_AGENT_AI_PROVIDER=codex` runs the local server-side research provider for backtesting, variants and paper tests.
- `THOON_AGENT_AI_PROVIDER=openai` or `openai-compatible` can call a remote model from the server only.
- `THOON_AGENT_AI_API_KEY` must never be exposed in client code.
- Strategy research can be aggressive; live launch, live orders, API key changes and Risk Rules edits remain blocked outside explicit production flows.

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
- `/api/observability/metrics` exposes in-process counters for requests, API errors, risk blocks and live order routing.
- `.github/workflows/ci.yml` runs lint, typecheck, build and functional tests on pull requests and main.
