# Thoon

**Thoon** est un cockpit personnel de trading crypto.

Il combine :

- charting avancé ;
- outils visuels de position ;
- trade markers déplaçables ;
- backtesting ;
- paper trading ;
- création de stratégies ;
- création de bots ;
- connexion API aux exchanges ;
- gestion stricte du risque.

## Vision

Thoon ne doit pas être une application lourde remplie de texte.
L’interface doit être simple en façade, puissante en profondeur.

## Stack frontend

- Next.js App Router.
- React.
- TypeScript.
- Dark mode par défaut, light mode disponible.

Sauf demande explicite contraire, Thoon doit toujours être développé avec Next.js.

L’utilisateur doit pouvoir :

1. choisir une crypto ;
2. analyser le chart ;
3. placer une entrée, une sortie, un stop-loss et des take-profits directement sur le graphique ;
4. tester une idée ;
5. créer une stratégie ;
6. créer un bot ;
7. connecter un exchange ;
8. exécuter en paper trading ou en réel ;
9. suivre ses résultats ;
10. protéger son capital.

## Pages principales

- Charts.
- Markets.
- Watchlist.
- Backtest.
- Strategies.
- Bots.
- Orders.
- Alerts.
- History.
- Preferences.

## Fonction centrale : Trade Markers

Sur la page Charts, Thoon doit proposer un onglet dédié avec des instruments déplaçables :

- Entry.
- Exit.
- Stop Loss.
- Take Profit.
- TP2.
- Buy Limit.
- Sell Limit.
- Alert.

Quand un marqueur est posé sur le graphique, il met à jour automatiquement le panneau de trading.

## Modules clés

### Chart Engine

- Candlesticks.
- Volume.
- Timeframes.
- Outils de dessin.
- Indicateurs.
- Sauvegarde de layout.
- Les bougies sont lues depuis les API publiques d'exchange; les données de seed ne contiennent pas de faux OHLC.

### Position Builder

- Long / Short.
- Entrée.
- Stop-loss.
- Take-profit.
- Multi-TP.
- Risk/reward.
- Levier.
- Frais.
- Break-even.
- Trailing stop.

### Strategy Builder

- Conditions d’entrée.
- Conditions de sortie.
- Risk settings.
- Backtest.
- Create Bot.

### Strategy Agent

- Mode `codex` par défaut pour Thoonix, la recherche stratégie côté serveur.
- Variantes, backtests, comparaisons et paper tests peuvent tourner agressivement.
- La stratégie core `Core TRIX Donchian ATR 1H` reste protégée : l’agent crée des versions, il ne remplace pas l’original.
- Le MCP TradingView `tradingview` peut être utilisé par Codex pour lire des charts, récupérer du contexte TA public et importer des idées de stratégie avant validation Thoon.
- Les providers `openai` et `openai-compatible` sont prêts via variables serveur, sans exposer de clé au client.
- Live trading, API keys et Risk Rules restent hors boucle automatique.

### Bot Builder

- Strategy.
- Exchange.
- Pair.
- Paper / Live.
- Risk per trade.
- Max daily loss.
- Launch / pause / stop.

### Risk Engine

- Bloque les ordres dangereux.
- Bloque les ordres sans stop-loss.
- Arrête les bots si drawdown atteint.
- Limite les pertes journalières.
- Confirme les ordres réels.

## Exchanges prévus

- Binance.
- Bybit.
- OKX.
- Bitget.
- Kraken.
- KuCoin.
- Coinbase Advanced.

## Style UI

- Dark mode par défaut.
- Light mode disponible.
- Peu de texte.
- Icônes simples.
- Actions visibles.
- Menus propres.
- Informations uniquement utiles.
- Pages connectées entre elles.

## Documents associés

- `PLAN.md` : plan de développement.
- `AGENT.md` : règles pour l’agent ou développeur qui travaille sur Thoon.
- `thoon_roadmap_succes.md` : roadmap produit complète issue de la conversation.
- `THOON_CODEX_GOALS.md` : objectifs page par page et feature par feature.
- `THOON_PRODUCTION_READINESS.md` : checklist runtime pour auth, Postgres, live exchange, secrets, CI et monitoring.
- `ROADMAP_HEDGEFUND_MODULES.md` : roadmap Bud importée dans Thoon avec les gates hedge fund 11 à 22.

## Production

Avant de passer en réel :

```bash
npm run auth:hash -- "mot-de-passe-long"
npm run db:migrate
npm run db:push
npm run saas:bootstrap
npm run verify
```

L’endpoint `/api/production/readiness` doit répondre `ok: true` avant `THOON_APP_MODE=live-enabled`.

### Trading réel contrôlé

Thoon expose maintenant `/api/bud/trade` comme route serveur unique vers Bud `/trade`. Les ordres paper passent, mais tout payload live est bloqué tant que `/api/bud/hedge-fund-readiness` ne répond pas `liveReady: true`. Le chemin historique `/api/trading/execute` route aussi vers Bud quand `THOON_LIVE_EXCHANGE_PROVIDER=bud`, ce qui évite l’ancien exécuteur local Binance-only. Les routes Binance, Bybit et Bitget existent côté Bud pour l’exécution signée. Hyperliquid utilise maintenant le SDK officiel `hyperliquid-python-sdk` via API wallet/vault, et dYdX utilise le SDK officiel `dydx-v4-client` via permissioned key + authenticator; les deux restent désactivés par défaut tant que `HYPERLIQUID_OFFICIAL_SIGNER_ENABLED=true` ou `DYDX_OFFICIAL_SIGNER_ENABLED=true` ne sont pas posés et validés par la readiness Bud.

Pour ton mode mono-utilisateur, garde `THOON_SAAS_MODE=disabled` et `THOON_LIVE_OPERATOR_MODE=single-user`. Le passage live CEX demande au minimum `THOON_APP_MODE=live-enabled`, `THOON_DATABASE_PROVIDER=postgres`, `THOON_AUTH_MODE=local-required`, une vraie `THOON_ENCRYPTION_KEY`, `THOON_LIVE_EXCHANGE_PROVIDER=bud`, `EXECUTION_LIVE_TRADING_ENABLED=true`, puis les secrets serveur Binance/Bybit/Bitget nécessaires. L’endpoint `/api/live-connectors/readiness` affiche séparément la readiness serveur des CEX et les blocages DEX officiels.

Les agents non-LLM sont exposés via `/api/strategy-agents/deterministic`. Ils récupèrent des métadonnées publiques TradingView, les soumettent au registre de recherche Thoon et créent des tâches de backtest/paper uniquement. Le test demandé de bot paper 2h passe par `/api/bud/paper-bot-test`: il ouvre une micro-position paper, trace une `PaperTestSession`, puis clôture et mesure le résultat à l’échéance.

La route `/api/wallets/readiness` vérifie Binance, Bybit, Bitget, Hyperliquid et dYdX, les clés de trade, WalletConnect et les wallets injectés/publics. Elle bloque explicitement les DEX live tant que le signer officiel isolé n’est pas activé, que le SDK Python requis n’est pas importable, ou que le wallet/authenticator ne passe pas les gates.

En mode `THOON_DATABASE_PROVIDER=postgres`, lance `npm run db:migrate` puis `npm run db:push` pour créer le snapshot durable. Les mutations API attendent ensuite le miroir Postgres avant de répondre.

Pour le mode SaaS v1, active `THOON_SAAS_MODE=enabled`, configure `DATABASE_URL`, `THOON_ADMIN_EMAIL`, `THOON_ADMIN_PASSWORD_HASH`, puis lance `npm run db:migrate` et `npm run saas:bootstrap`. Le bootstrap crée le workspace owner, sauvegarde l’ancien état dans `thoon_app_state_backups`, puis initialise `workspace_state` sans écraser un workspace déjà créé.

Les plans payants passent par Stripe via `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` et les quatre `STRIPE_PRICE_*`. Free reste local, Pro et Elite utilisent Checkout/Portal, et le live SaaS reste bloqué tant que le workspace n’est pas Elite actif avec validation admin.

`npm run verify` exécute lint, typecheck, build, tests fonctionnels, smoke staging authentifié et smoke navigateur Playwright. La CI GitHub lance aussi `npm audit --omit=dev` et installe Chromium pour le contrôle E2E.

Pour staging, pars de `.env.staging.example` : auth locale requise, secrets longs, rate limiting runtime actif, politique edge/WAF déclarée et audit log avec rétention longue.

Pour le live, une clé Binance avec permission trade doit être sauvegardée, testée, puis visible en statut `active`. Par défaut `THOON_LIVE_ORDER_ENDPOINT=test` utilise l’endpoint signé de test Binance ; le passage à `live` doit rester une bascule volontaire après smoke test contrôlé.

Pour Thoonix en mode agent direct :

```bash
THOON_AGENT_AI_PROVIDER=codex
THOON_AGENT_CHAT_MODEL=gpt-5.5
# Optionnel: laisse vide pour utiliser $CODEX_HOME/auth.json ou ~/.codex/auth.json.
THOON_AGENT_CODEX_AUTH_FILE=
```

En mode `codex`, Thoonix utilise le transport OAuth Codex direct vers `https://chatgpt.com/backend-api/codex/responses`, connecté au forfait ChatGPT/Codex de la machine, sans clé OpenAI API serveur et sans relancer `codex exec` à chaque message. Le chat affiche une progression pendant que le vrai moteur Thoonix/Codex travaille; il ne doit pas remplacer une réponse lente ou bloquée par un message pré-enregistré. L’agent stratégie ne doit jamais inventer un résultat. Les crons sauvegardent uniquement des backtests calculés depuis des bougies live strictes; si TradingView ne donne aucune nouvelle piste publique, l’agent crée des stratégies d’innovation séparées puis les teste avant tout classement.

Le MCP TradingView utilisé par Thoonix est enregistré côté Codex sous le nom `tradingview` avec `npx -y tradingview-mcp-server@0.6.1`. Vérification locale :

```bash
codex mcp list
```

Thoon expose ce statut dans le chat Agent. Quand l’utilisateur demande une analyse TradingView, un chart, une recherche de symbole ou une stratégie importable, Thoonix peut utiliser le contexte MCP pour orienter la recherche, sauvegarder des concepts publics, puis Thoon valide chaque idée avec ses propres backtests et paper tests.

La boucle Kronos learning enregistre des prévisions par marché/timeframe, évalue les anciennes prévisions quand les candles futures sont disponibles, puis calcule un poids de confiance transmis à Thoonix. Ce poids sert seulement à prioriser la recherche et les backtests; il ne remplace jamais les résultats calculés, les paper tests ou le Risk Engine.

Pour brancher un provider compatible OpenAI, garde l’appel serveur :

```bash
THOON_AGENT_AI_PROVIDER=openai
THOON_AGENT_AI_API_KEY=...
THOON_AGENT_AI_ENDPOINT=responses
```

En mode SaaS, chaque workspace peut aussi gérer ses providers depuis `/preferences/agent-connections`.
Les clés OpenAI ou compatibles sont chiffrées côté serveur et masquées dans l’UI. Le mode Codex Bridge prépare un pairing outbound pour une future app Mac/Tauri ou un worker local, sans exposer de port public.

## Support

If this project is useful to you, you can support its development with a free and entirely optional tip through the repository's **Sponsor** button. Thank you for your support.
