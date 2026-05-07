# PLAN.md — Plan de développement Thoon

## Objectif

Créer **Thoon**, une application privée de trading crypto avec :

- charting avancé ;
- outils visuels de position ;
- trade markers déplaçables ;
- backtesting ;
- paper trading ;
- création de stratégies ;
- création de bots ;
- connexion API aux exchanges ;
- gestion stricte du risque ;
- interface épurée dark/light.

## Priorité 1 — Socle fonctionnel

### 1. Chart principal

- Candlesticks.
- Volume.
- Timeframes.
- Crosshair.
- Zoom.
- Indicateurs de base.
- Outils de dessin.
- Barre d’outils verticale.
- Mode clair / sombre.

### 2. Trade Markers

Créer un onglet dédié sur la page Charts avec des instruments déplaçables :

- Entry.
- Exit.
- Stop Loss.
- Take Profit.
- TP2 / TP3.
- Buy Limit.
- Sell Limit.
- Alert.

Chaque marqueur posé sur le graphique doit mettre à jour automatiquement le panneau de trading.

### 3. Position Builder

- Direction Long / Short.
- Entrée.
- Stop-loss.
- Take-profit.
- Multi-TP.
- Risk/reward.
- Taille de position.
- Levier.
- Frais.
- Break-even.
- Trailing stop.
- Paper Trade / Live Trade.
- Execute Trade.
- Save Setup.
- Create Alert.

## Priorité 2 — Trading et connexion

### 4. Exchange & API

- Connexion Binance.
- Connexion Bybit.
- Connexion OKX.
- Connexion Bitget.
- Ajout de clés API.
- Test de connexion.
- Permissions Read / Trade.
- IP whitelist.
- Health check.
- Chiffrement des clés.
- Révocation des clés.

### 5. Orders

- Positions ouvertes.
- Ordres ouverts.
- Fills.
- Historique.
- Close position.
- Cancel order.
- Close all.
- Export.

## Priorité 3 — Stratégies et bots

### 6. Strategy Builder

- Nom de stratégie.
- Marché / paire.
- Timeframe.
- Type de stratégie.
- Conditions d’entrée.
- Conditions de sortie.
- Risk settings.
- Save.
- Backtest.
- Create Bot.

### 7. Bot Builder

- Nom du bot.
- Stratégie.
- Exchange.
- Paire.
- Mode Paper / Live.
- Capital alloué.
- Risque par trade.
- Perte journalière max.
- Levier max.
- Max concurrent trades.
- Launch Bot.
- Save Draft.

## Priorité 4 — Test et progression

### 8. Backtest

- Choix stratégie.
- Période.
- Capital initial.
- Frais.
- Slippage.
- Résultats.
- Equity curve.
- Drawdown.
- Liste des trades.
- Export report.

### 9. Replay / Paper Testing

- Rejouer le marché.
- Cacher le futur.
- Acheter / vendre fictivement.
- Log de trades.
- Résultat automatique.

### 10. Trade Journal

- Tous les trades.
- Trades manuels.
- Trades bot.
- Trades paper.
- Notes.
- Capture chart.
- R/R.
- PnL.
- Mistakes & lessons.

## Priorité 5 — Sécurité et préférences

### 11. Risk Rules

- Risque max par trade.
- Perte journalière max.
- Perte hebdomadaire max.
- Levier max.
- Bloquer les ordres sans stop-loss.
- Stop bots at max drawdown.
- Confirm before real orders.
- Emergency kill switch.

### 12. Préférences

- Profile.
- Appearance.
- Trading Defaults.
- Security.
- Notifications.
- Exchange & API.
- Billing & Plan.
- Data & Privacy.
- Risk Rules.
- Trade Limits.
- Audit Logs.
- Layouts / Workspace.

## Pages encore à créer en images

### Priorité forte

1. Strategy Detail.
2. Bot Detail.
3. Trade Limits.
4. Audit Logs.
5. Confirmation Live Order.
6. Confirmation Launch Bot Live.

### Priorité moyenne

7. Empty State — No Bot.
8. Empty State — No Exchange Connected.
9. Error State — Order Blocked by Risk Engine.
10. Error State — API Disconnected.
11. Strategy Templates.
12. Bot Logs detailed page.

## Règle produit

Thoon doit rester :

- épuré ;
- visuel ;
- rapide ;
- connecté ;
- sécurisé ;
- compréhensible ;
- professionnel.
