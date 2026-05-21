# Audit Frontend Thoon

## Decision

- Garder uniquement les pages utiles maintenant.
- Supprimer les routes legacy qui affichent l'ancien moteur Thoon.
- Garder les API Bud.
- Reconstruire ensuite les pages supprimees avec Bud comme source.
- Aucune page visible ne doit afficher un resultat fake.
- Aucun lien visible ne doit pointer vers une page legacy.
- Nettoyage applique: routes legacy retirees du dossier `src/app`.
- Nettoyage applique: composants de pages legacy retires de `src/screens`.
- Nettoyage applique: sidebar reduite aux pages gardees.
- Nettoyage applique: Preferences reduit aux sections gardees.
- Nettoyage applique: chat flottant Thoonix retire de `AppLayout`.
- Nettoyage applique: API legacy `/api/agent`, `/api/alerts`, `/api/backtests`, `/api/bots`, `/api/strategies` bloquees en `410`.
- Reconstruction appliquee: pages metier remises en routes Bud-backed.
- Reconstruction appliquee: etat Bud global affiche dans `AppLayout`.

## Pages Gardees

| Route | Statut | Source | Action |
| --- | --- | --- | --- |
| `/` | GARDER | redirect `/charts` | Garder |
| `/charts` | GARDER AVEC NETTOYAGE | Binance/Bud + legacy local partiel | Garder, retirer liens legacy |
| `/markets` | GARDER | Binance/Bud tickers/candles | Garder, retirer actions strategy/alert |
| `/exchanges` | GARDER A ADAPTER | credentials/local + readiness Bud a brancher | Garder, brancher Bud live-readiness |
| `/preferences` | GARDER AVEC NETTOYAGE | config locale | Garder sections utiles |
| `/preferences/profile` | GARDER | config locale | Garder |
| `/preferences/appearance` | GARDER | config locale | Garder |
| `/preferences/trading-defaults` | GARDER | config locale | Garder |
| `/preferences/security` | GARDER | keys/risk/audit local | Garder |
| `/preferences/risk-rules` | GARDER | risk settings | Garder, brancher Bud risk |
| `/preferences/trade-limits` | GARDER | limits settings | Garder, brancher Bud risk |
| `/preferences/audit-logs` | GARDER | audit local | Garder |
| `/preferences/data-privacy` | GARDER | local privacy | Garder |
| `/login` | GARDER | auth | Garder |

## Pages Legacy Supprimees Puis Reconstruites Bud

| Route | Probleme | Remplacement |
| --- | --- | --- |
| `/agent` | Ancien Strategy Agent Thoon | redirect `/agents` |
| `/agents` | Ancien agent UI | reconstruit sur `/api/bud/orchestrate`, `/api/bud/macro`, `/api/bud/portfolio`, `/api/bud/arbitrage` |
| `/backtest` | ancien moteur UI | reconstruit sur `/api/bud/backtest` |
| `/backtest/replay` | replay legacy | reste supprime |
| `/strategies` | registry legacy | reconstruit sur `/api/bud/research` et `/api/bud/backtest` |
| `/strategies/new` | builder legacy | reste supprime |
| `/strategies/[id]` | detail legacy | reste supprime |
| `/strategies/core-lab` | lab legacy | reste supprime |
| `/bots` | bots legacy | reconstruit en launch gate Bud sur `/api/bud/live-readiness` |
| `/bots/new` | bot builder legacy | reste supprime |
| `/bots/[id]` | detail bot legacy | reste supprime |
| `/bots/[id]/logs` | logs legacy | reste supprime |
| `/orders` | ordres legacy | reconstruit sur `/api/bud/execution`, `/api/bud/paper`, `/api/bud/kill-switch` |
| `/alerts` | alertes locales legacy | reconstruit sur readiness + kill switch Bud |
| `/history` | journal legacy | reconstruit sur paper trades + research history Bud |
| `/watchlist` | ancienne liste locale | reconstruit sur Binance live feed |
| `/top-strategies` | doublon strategies/agent legacy | supprime |
| `/preferences/agent` | ancien Thoonix direct | future Gateway settings Bud |
| `/preferences/agent-connections` | providers directs hors Bud | future Gateway-only config |
| `/preferences/notifications` | depend alertes legacy | future observability alerts |
| `/preferences/billing` | non utile au cockpit local actuel | supprime |
| `/preferences/layouts` | non prioritaire | supprime |
| `/preferences/keyboard-shortcuts` | non prioritaire | supprime |
| `/preferences/advanced` | trop generique | supprime |

## Liens A Supprimer

- Sidebar: Agent, Backtest, Strategies, Bots, Orders, Alerts, History, Watchlist, Top Strategies.
- Topbar: Alerts.
- Topbar: faux agent `Alpha-01`.
- Topbar: faux equity `25,000.00 USDT`.
- Topbar: bouton `websocket` qui ne controle rien.
- Global: chat flottant Thoonix direct vers `/api/agent/chat`.
- Markets: `Add to strategy`.
- Markets: `Create alert`.
- Charts: `Replay` vers `/backtest/replay`.
- Charts: `Create Alert` vers `/alerts`.
- Charts: `Convert` vers `/strategies`.
- Preferences hub: Agent, Thoonix, Notifications, Billing, Layouts, Keys, Advanced.

## Pages A Reconstruire Ensuite

| Future page | Backend source obligatoire |
| --- | --- |
| Strategy detail | `/api/bud/research` |
| Backtest replay | `/api/bud/backtest`, future paper validation Bud |
| Bot detail/logs | `/api/bud/live-readiness`, future automation Bud |
| Paper Trading detail | `/api/bud/paper` |
| Execution detail | `/api/bud/execution`, `/api/bud/live-readiness`, `/api/bud/kill-switch` |
| Portfolio | `/api/bud/portfolio` |
| Arbitrage | `/api/bud/arbitrage` |
| Alerts/Monitoring | Prometheus/Grafana/Bud observability |

## Regles Apres Nettoyage

- Nouvelle page = maquette d'abord.
- Nouvelle page = source Bud ou exchange reel.
- Pas de seed-data pour afficher une performance.
- Pas de faux montant paper dans la topbar.
- Pas de lien vers une route non reconstruite.
