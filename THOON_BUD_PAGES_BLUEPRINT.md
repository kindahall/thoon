# Blueprint Pages Bud-Thoon

## Direction Visuelle

- Surface principale: terminal dense, cartes fines, badges de statut, tableaux compacts.
- Navigation: pages metier visibles dans la sidebar.
- Donnees: uniquement `/api/bud/*`, Binance live via modules existants, ou etat explicite indisponible.
- Aucune performance inventee.
- Aucune strategie, alerte, bot ou ordre fake.
- Etat Bud global visible dans `AppLayout` sur toutes les pages.

## Pages Reconstruites

| Route | Source | Actions |
| --- | --- | --- |
| `/agents` | `/api/bud/status`, `/api/bud/orchestrate`, `/api/bud/macro`, `/api/bud/portfolio`, `/api/bud/arbitrage` | Run decision, scan macro, scan arbitrage |
| `/backtest` | `/api/bud/backtest` | Run walk-forward backtest |
| `/strategies` | `/api/bud/research`, `/api/bud/backtest` | Load registry, run research, test candidate |
| `/bots` | `/api/bud/status`, `/api/bud/live-readiness`, `/api/bud/execution` | Check launch readiness, show blockers |
| `/orders` | `/api/bud/execution`, `/api/bud/paper`, `/api/bud/kill-switch` | Read positions, paper buy/sell, emergency stop |
| `/alerts` | `/api/bud/live-readiness`, `/api/bud/kill-switch`, `/api/bud/status` | Risk checks, kill switch status |
| `/history` | `/api/bud/paper`, `/api/bud/research` | Paper trades, research runs/evaluations |
| `/watchlist` | Binance live market feed + chart links | Real tracked symbols |

## Interaction

- Agents produisent une decision structuree; Strategy/Backtest lisent ou testent ensuite.
- Backtest n'utilise que les candles reelles Bud/Binance.
- Bots restent verrouilles si Bud live readiness bloque.
- Orders restent en paper par defaut; live ne passe pas sans readiness.
- Alerts affichent risques reels, blockers et kill switch.
