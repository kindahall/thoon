# Fusion Thoon/Bud

## Cible

- Projet final = `/Users/Artisaul/Desktop/Thoon`
- Backend quant = `/Users/Artisaul/Desktop/Thoon/backend`
- Ancien Bud = source migrée, supprimable après autonomie Python validée
- Frontend Bud = archivé
- UI finale = Thoon uniquement
- Données de trading = réelles uniquement
- LLM = gateway uniquement
- Live trading = désactivé par défaut
- Ordre réel = readiness + risk engine + confirmation forte

## Architecture Active

```text
Thoon UI
→ routes serveur Thoon `/api/bud/*`
→ client serveur `src/server/bud-backend-client.ts`
→ FastAPI intégré `backend/main.py`
→ Binance / Bybit / FRED / exchanges réels / LLM Gateway
```

## Règles D'Intégration

- Navigateur interdit d'accès direct au backend d'exécution
- Pas de proxy générique vers `/trade`
- Routes Thoon dédiées uniquement
- Paper trading exposé avant live trading
- Live readiness obligatoire avant tout live
- Kill switch exposé et contrôlé
- Seed data interdit pour décisions trading
- Fallback UI autorisé seulement avec erreur explicite
- Ancien moteur Thoon = legacy tant qu'il reste visible

## Backend Intégré

- `backend/main.py` = `Thoon/Bud Quant Backend`
- `backend/api/market.py` = health, price, candles, ticker 24h
- `backend/backtest/engine.py` = vectorbt si disponible, fallback pandas réel si vectorbt absent
- `backend/.gitignore` = venv/cache/runtime ignorés
- `package.json` = `backend:venv`, `backend:dev`
- `.env.example` = `THOON_BUD_BACKEND_URL`, `THOON_BUD_BACKEND_TIMEOUT_MS`, `THOON_BUD_UVICORN_BIN`

## Routes Thoon Vers Backend

- `GET /api/bud/status`
- `GET|POST /api/bud/process`
- `POST /api/bud/orchestrate`
- `POST /api/bud/backtest`
- `GET|POST /api/bud/research`
- `GET|POST /api/bud/paper`
- `GET|POST /api/bud/live-readiness`
- `GET /api/bud/hedge-fund-readiness`
- `GET|POST /api/bud/kill-switch`
- `POST /api/bud/arbitrage`
- `POST /api/bud/portfolio`
- `POST /api/bud/macro`
- `GET /api/bud/execution`

## Contrats Backend Utilisés

- `GET /health`
- `GET /price/{symbol}`
- `GET /ticker/{symbol}`
- `GET /candles/{symbol}`
- `POST /orchestrate/strategy`
- `POST /backtest/run`
- `GET /paper/{symbol}/state`
- `GET /paper/{symbol}/trades`
- `POST /paper/orders`
- `GET|POST /live-readiness/check`
- `GET|POST /kill-switch`
- `GET /execution/capabilities`
- `GET /positions`
- `POST /arbitrage/scan`
- `POST /portfolio/advanced/construct`
- `POST /macro-quant/analyze`
- `GET /research-platform/runs`
- `GET /research-platform/strategies`
- `GET /research-platform/evaluations`
- `POST /research-platform/run`

## Migration

### F1 - Fondation

- Statut = FAIT
- Config Thoon vers backend intégré
- Client serveur Bud
- Routes health/process
- Scripts backend
- Backend copié dans Thoon

### F2 - Market Data

- Statut = FAIT
- Prix via Binance réel
- Ticker 24h via Binance réel
- Candles via backend réel
- ONDOUSDT ajouté sans prix fictif
- Paires indisponibles omises au lieu d'être inventées

### F3 - Agents

- Statut = FAIT CÔTÉ ROUTE, UI FINALE À DESSINER
- `/api/bud/orchestrate` branché
- Timeout augmenté pour LangGraph + LLM Gateway
- Panneau Bud provisoire retiré de `/agent`
- Prochaine UI = intégration Thoon propre, pas carte Bud séparée

### F4 - Backtest + Research

- Statut = FAIT CÔTÉ ROUTE
- Backtest réel branché
- Research runs/strategies/evaluations branchés
- Fallback pandas réel si vectorbt absent localement
- Prochaine UI = remplacer écrans legacy Thoon

### F5 - Paper Trading

- Statut = FAIT CÔTÉ ROUTE
- State paper réel-prix
- Trades paper
- Ordre paper uniquement
- Live flags rejetés côté route

### F6 - Risk + Live Readiness

- Statut = FAIT CÔTÉ ROUTE
- Readiness Binance/Bybit
- Blockers exposés
- Kill switch trigger/status/reset
- Reset protégé par confirmation

### F7 - Execution

- Statut = FAIT CÔTÉ ROUTE SÛRE
- Capabilities exposées
- Positions exposées
- Aucun endpoint live order exposé à l'UI
- `/trade` non proxifié

### F8 - Nettoyage Legacy

- Statut = À FAIRE
- Retirer anciens moteurs Thoon des décisions
- Remplacer pages Backtest/Strategies/Orders par routes intégrées
- Garder historique legacy uniquement marqué
- Créer UI finale Thoon/Bud par maquettes

### F9 - Autonomie Ancien Bud

- Statut = CORE FAIT, FULL PYTHON 3.11 À FAIRE
- `backend/.venv` créé dans Thoon
- `backend/requirements-core.txt` installé dans Thoon
- Backend lancé depuis Thoon uniquement
- `/api/bud/process` = managed true, online
- Vérifier que `/Users/Artisaul/Desktop/Bud Ai` n'est plus utilisé
- Installer Python 3.11 pour `backend:venv:full`
- Supprimer ancien Bud seulement après validation full

## Tests Réalisés

- `npm run typecheck` = OK
- `npm run lint` = OK
- `npm run build` = OK avec warning Turbopack NFT sur `/api/bud/process`
- `backend/.venv/bin/python -m py_compile ...` = OK
- `GET /api/bud/process` = managed true, online, pid actif
- `GET /api/markets` = provider Bud, prix réels, ONDO présent
- `GET /api/markets/candles?symbol=ONDO/USDT` = candles Binance réelles
- `GET /api/bud/status` = backend online
- `GET /api/bud/paper` = prix réel, trades/risk disponibles
- `POST /api/bud/live-readiness` = live bloqué sans credentials
- `GET /api/bud/hedge-fund-readiness` = gates hedge fund 11-22 calculés depuis les preuves Thoon/Bud
- `POST /api/bud/arbitrage` = opportunités réelles ou vide, pas de prix inventé
- `POST /api/bud/portfolio` = allocation calculée sur données réelles
- `POST /api/bud/backtest` = backtest réel sur candles Binance
- `POST /api/bud/orchestrate` = OK, décision structurée agents + risk profile + regime

## Tests À Relancer Après Ce Patch

- Smoke navigateur après refonte UI
- `backend:venv:full` quand Python 3.11 est disponible
- Test RL/vectorbt complet après full venv

## Prochaines Actions

- Transformer Backtest/Strategies/Orders en UI Thoon branchée Bud
- Dessiner nouvelle intégration visuelle des agents avant de coder
- Supprimer warning Turbopack NFT ou isoler `/api/bud/process`
- Installer Python 3.11 pour dépendances full
