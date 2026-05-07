# Thoon — Roadmap produit et pages restantes

## 1. Vision claire de Thoon

**Thoon** est une application privée de trading crypto, pensée pour une seule personne ou un petit usage personnel, avec une interface épurée, compréhensible par un débutant mais assez puissante pour un trader professionnel.

L’objectif n’est pas de créer une application remplie de textes, de menus inutiles ou de fonctions décoratives. L’objectif est de créer un **cockpit de trading visuel** où chaque outil fait réellement ce qu’on attend de lui.

### Formule produit

> **Thoon = charting avancé + outils de position visuels + backtesting + paper trading + bots + stratégies + connexion API exchange + contrôle du risque.**

---

## 2. Principes non négociables

### Interface

- Interface épurée.
- Peu de texte.
- Navigation claire.
- Design dark/light.
- Menus visibles mais pas encombrants.
- Chaque page doit avoir uniquement les informations utiles à son usage.
- Toutes les pages doivent être connectées entre elles.

### Usage

L’utilisateur doit pouvoir :

1. regarder le marché ;
2. choisir une crypto ;
3. analyser le chart ;
4. placer visuellement une entrée, une sortie, un stop-loss et des take-profits ;
5. tester une idée ;
6. créer une stratégie ;
7. transformer une stratégie en bot ;
8. connecter un exchange ;
9. exécuter en paper trading ou en réel ;
10. suivre ses résultats ;
11. protéger son capital avec des règles strictes.

---

## 3. Base produit déjà validée en images

Nous avons déjà une bonne base visuelle pour :

- Dashboard chart principal.
- Version dark mode.
- Version light mode.
- Menu latéral épuré.
- Boutons de connexion exchange/API.
- Page Markets.
- Page Backtest.
- Page Strategies.
- Page Bots.
- Page Orders.
- Page Alerts.
- Page Preferences.
- Apparence.
- Trading Defaults.
- Security.
- Notifications.
- Billing & Plan.
- Data & Privacy.
- Exchange & API.
- Connect Exchange / Add API Key.
- Créer stratégie.
- Créer bot.
- Position Builder complet.
- Replay / Paper Testing.
- Trade Journal.
- Risk Rules.
- Layouts / Workspace.
- Watchlist / Mes listes / Favoris.
- Onglet Trade Markers déplaçables sur le chart.

---

## 4. Architecture des pages principales

### Menu principal

Le menu principal doit rester simple :

```text
Charts
Markets
Watchlist
Backtest
Strategies
Bots
Orders
Alerts
History
Preferences
```

### Barre supérieure

La barre supérieure doit contenir :

```text
Logo Thoon
Recherche crypto / paire
Timeframe
Indicators
Draw
Backtest
Strategies
Bots
Mode clair / sombre
Connect Exchange
Connect API
Profil utilisateur
```

---

## 5. Page Charts

La page Charts est le cœur de Thoon.

### Éléments essentiels

- Chart principal en chandeliers.
- Volume.
- Timeframes.
- Outils de dessin.
- Indicateurs.
- Panneau de trading.
- Position Builder.
- Onglet spécial Trade Markers.
- Bouton Paper Trade / Live Trade.
- Bouton Execute Trade.
- Bouton Save Setup.
- Bouton Create Alert.

### Onglet Trade Markers

C’est une idée centrale à conserver.

L’utilisateur doit avoir un onglet séparé, toujours accessible sur la page chart, avec des instruments déplaçables :

```text
Entry
Exit
Stop Loss
Take Profit
TP2
Buy Limit
Sell Limit
Alert
```

Fonctionnement :

- L’utilisateur prend l’instrument **Entry** et le pose sur le chart.
- Thoon définit automatiquement le prix d’entrée.
- L’utilisateur prend **Exit** et le pose ailleurs.
- Thoon définit la sortie.
- L’utilisateur prend **Stop Loss** et le pose sur le chart.
- Thoon calcule le risque.
- L’utilisateur prend **Take Profit** et le pose sur le chart.
- Thoon calcule le gain potentiel et le risk/reward.
- Tous les marqueurs restent déplaçables.
- Le panneau de droite se met à jour automatiquement.

### À prévoir en plus

- Multi-TP : TP1, TP2, TP3.
- Break-even automatique.
- Trailing stop.
- Frais estimés.
- Prix de liquidation si levier.
- Sauvegarde du setup.
- Transformation du setup en stratégie.

---

## 6. Page Watchlist

La page Watchlist doit contenir :

```text
Mes listes
Favoris
Paires suivies
Prix
Variation
Volume
Alertes actives
Bouton ouvrir sur chart
Bouton ajouter à stratégie
```

### Fonctionnalités

- Créer une nouvelle liste.
- Renommer une liste.
- Supprimer une liste.
- Ajouter une paire à une liste.
- Retirer une paire.
- Trier par prix, variation, volume ou alertes.
- Filtrer Spot / Perp / Futures.
- Voir uniquement les paires avec alertes.
- Ouvrir une paire directement sur le chart.
- Ajouter une paire comme condition ou marché cible dans une stratégie.

---

## 7. Page Markets

La page Markets doit servir à explorer le marché sans surcharge.

### Contenu utile

- Market cap global.
- Volume 24h.
- BTC dominance.
- ETH dominance.
- Heatmap.
- Top movers.
- Gainers / losers.
- Catégories : All, Trending, DeFi, Layer 1, Meme, AI.
- Liste des cryptos avec prix, variation, volume et market cap.

### Actions

- Ajouter à watchlist.
- Ouvrir sur chart.
- Ajouter à stratégie.
- Créer alerte.

---

## 8. Page Position Builder

Le Position Builder doit être complet et visuel.

### Informations nécessaires

```text
Pair
Direction : Long / Short
Entry
Stop Loss
Take Profit
TP multiples
Risk %
Position Size
Leverage
Fees
Break-even
Liquidation price
Trailing Stop
Risk/Reward
Potential Profit
Potential Loss
Paper Trade
Live Trade
Execute
Save Setup
Create Alert
```

### Règle UX

L’utilisateur ne doit pas remplir 20 champs à la main si les niveaux peuvent être placés sur le chart.

Les champs doivent être synchronisés avec les marqueurs visuels.

---

## 9. Page Backtest

La page Backtest doit permettre de tester une stratégie sur des données historiques.

### Paramètres

```text
Strategy
Market / Pair
Timeframe
Date Range
Initial Capital
Fees
Slippage
Mode : Spot / Perp / Futures
Leverage
Risk per trade
Max daily trades
Max drawdown
```

### Résultats

```text
Equity Curve
Net Profit
Total Return
Win Rate
Profit Factor
Max Drawdown
Total Trades
Winning Trades
Losing Trades
Buy & Hold comparison
Trade list
Monthly returns
Drawdown chart
Export report
```

### Actions

- Run Backtest.
- Save Report.
- Open in Paper Test.
- Create Bot from result.
- Edit Strategy.

---

## 10. Page Replay / Paper Testing

Le Replay / Paper Testing doit permettre de tester manuellement une idée.

### Fonctionnement

- Choisir une paire.
- Choisir une période.
- Cacher le futur du chart.
- Rejouer le marché.
- Acheter / vendre fictivement.
- Placer stop-loss et take-profit.
- Suivre le résultat.
- Journaliser automatiquement.

### Éléments nécessaires

```text
Replay Mode
Play / Pause
Speed
Go back 1D / 1H / 15m
Go forward 1D / 1H / 15m
Paper balance
Equity
Unrealized PnL
Buy
Sell
Close
Paper Trade Log
Export
```

---

## 11. Page Strategies

La page Strategies doit gérer les stratégies existantes.

### Liste

```text
Nom
Type
Marché
Timeframe
Status
Performance 30D
Actions
```

### Actions

- Créer nouvelle stratégie.
- Modifier.
- Dupliquer.
- Backtester.
- Créer bot.
- Archiver.
- Supprimer.

---

## 12. Page Créer stratégie

Cette page est centrale.

### Structure

```text
Strategy Name
Market / Pair
Timeframe
Strategy Type
Entry Conditions
Exit Conditions
Risk Settings
Save
Backtest
Create Bot
```

### Builder de conditions

Exemple :

```text
IF Price crosses above EMA 50
AND RSI greater than 50
AND Volume greater than SMA 20
THEN Enter Long

IF Price crosses below EMA 200
OR RSI greater than 70
THEN Exit Market
```

### Conditions possibles

- Prix.
- EMA.
- SMA.
- RSI.
- MACD.
- Volume.
- ATR.
- Zone dessinée.
- Breakout.
- Retest.
- Cross.
- Supérieur à.
- Inférieur à.

### Risk Settings

- Risk per trade.
- Account balance.
- Position sizing.
- Max open trades.
- Stop-loss.
- Take-profit.
- Trailing stop.
- Risk/reward target.
- Stop-loss required.

---

## 13. Page Strategy Detail — à créer en image

Cette page manque encore.

Elle doit apparaître quand l’utilisateur clique sur une stratégie existante.

### Contenu recommandé

```text
Strategy name
Status
Market / Pair
Timeframe
Type
Current performance
Linked bots
Backtest summary
Entry conditions
Exit conditions
Risk rules
Version history
Last updated
```

### Actions

```text
Edit
Duplicate
Backtest
Create Bot
Archive
Delete
Open on Chart
```

### Pourquoi c’est important

La page création ne suffit pas. Il faut une page de consultation claire pour comprendre ce que fait une stratégie déjà créée.

---

## 14. Page Bots

La page Bots doit gérer tous les bots.

### Liste

```text
Nom
Strategy
Exchange
Symbol
Mode : Paper / Live
Status
PnL
Actions
```

### Actions

- Créer bot.
- Pause.
- Stop.
- Modifier.
- Ouvrir logs.
- Ouvrir sur chart.
- Ouvrir backtest.

---

## 15. Page Créer bot

### Champs

```text
Bot Name
Strategy
Exchange
Market / Pair
Mode : Paper / Live
Allocated Capital
Risk Per Trade
Max Daily Loss
Max Leverage
Max Concurrent Trades
Schedule / Active Hours
Stop bot on drawdown
Require stop-loss on all trades
Launch Bot
Save Draft
```

### Preview

Le panneau de droite doit montrer :

```text
Estimated behavior
Exchange
Strategy
Market / Pair
Mode
Allocated capital
Risk per trade
Max daily loss
Max concurrent trades
Leverage max
```

---

## 16. Page Bot Detail — à créer en image

Cette page manque encore.

Elle doit apparaître quand l’utilisateur clique sur un bot actif.

### Contenu recommandé

```text
Bot name
Bot ID
Status : Live / Paper / Paused / Stopped
Exchange
Strategy
Market / Pair
Capital allocated
Current position
Unrealized PnL
Realized PnL
Win rate
Max drawdown
Last signal
Last trade
Connection status
API status
```

### Onglets

```text
Overview
Performance
Positions
Logs
Settings
```

### Actions critiques

```text
Pause Bot
Resume Bot
Stop Bot
Edit Bot
Open on Chart
Open Backtest
Export Logs
```

---

## 17. Page Orders

La page Orders doit couvrir :

- Positions ouvertes.
- Ordres ouverts.
- Fills récents.
- Historique d’ordres.
- Close position.
- Cancel order.
- Close all.
- Export.

### Informations nécessaires

```text
Symbol
Side
Size
Entry Price
Mark Price
PnL
Margin
TP / SL
Status
Opened
Action
```

---

## 18. Page Alerts

La page Alerts doit permettre de créer et gérer :

- alertes prix ;
- alertes zone ;
- alertes indicateur ;
- alertes stratégie ;
- alertes bot ;
- alertes webhook.

### Champs

```text
Market
Alert Type
Condition
Price / Zone / Indicator
Trigger : once / repeat
Notify via app / email / webhook
Create Alert
```

---

## 19. Page Trade Journal

Le Trade Journal doit aider l’utilisateur à progresser.

### Contenu

```text
All Trades
Manual
Bot
Paper
Date
Pair
Side
Source
Result
R/R
PnL
Tag
Screenshot
Notes
Mistakes
Lessons
```

### Statistiques

```text
Win Rate
Average R Multiple
Total PnL
Best Trade
Worst Trade
Expectancy
Best Setup
```

---

## 20. Page Risk Rules

Cette page est indispensable pour protéger l’utilisateur.

### Règles globales

```text
Maximum risk per trade
Daily loss limit
Weekly loss limit
Maximum leverage
Block live orders without stop-loss
Stop bots at max drawdown
Confirm before real orders
Allowed trading session hours
Bot pause after loss streak
Emergency kill switch
Minimum balance
Cancel orders on disconnect
```

### Actions

- Save Rules.
- Enable Emergency Kill Switch.
- Disable trading if threshold reached.

---

## 21. Page Trade Limits — à créer en image

Cette page manque encore.

Elle doit compléter Risk Rules avec des limites opérationnelles plus précises.

### Contenu recommandé

```text
Max orders per day
Max orders per hour
Max open positions
Max position size per pair
Max total exposure
Max bot slots active
Max strategy executions per day
Max API errors before pause
Cooldown after losing trade
Cooldown after bot error
```

### Pourquoi c’est important

Risk Rules protège le capital. Trade Limits protège l’exécution et évite les comportements excessifs ou les bugs de bot.

---

## 22. Page Audit Logs — à créer en image

Cette page manque encore et elle est très importante.

### Contenu recommandé

```text
Date / time
Event type
User / system / bot
Exchange
Pair
Action
Status
IP address
Details
```

### Événements à logger

```text
Connexion API créée
Clé API modifiée
Clé API supprimée
Ordre envoyé
Ordre refusé
Ordre annulé
Position fermée
Bot lancé
Bot arrêté
Bot mis en pause
Stratégie modifiée
Risk rule modifiée
Emergency kill switch activé
Erreur exchange
Connexion échouée
```

### Actions

- Search logs.
- Filter by event.
- Filter by exchange.
- Filter by bot.
- Export logs.

---

## 23. Page Layouts / Workspace

Cette page permet de gérer l’espace de travail.

### Layouts

```text
Single Chart
Multi-Chart
Bot Monitor
Backtest Lab
Trade Journal
Custom Layout
```

### Actions

- Save current layout.
- Import layout.
- Apply layout.
- Duplicate layout.
- Edit layout.
- Delete layout.

### Paramètres

```text
Default workspace
Sidebar behavior
Panel docking
Widget visibility
Reset layout
```

---

## 24. Page Exchange & API

Cette page doit gérer les connexions.

### Contenu

```text
Supported exchanges
Connected exchanges
Add API Key
API Keys
Webhooks
Connection health
Permissions
IP whitelist
Encryption status
Audit logs link
Danger zone
```

### Exchanges à prévoir

```text
Binance
Bybit
OKX
Bitget
Kraken
KuCoin
Coinbase Advanced
```

### Sécurité

- Clés chiffrées.
- Permission read/trade.
- Retraits toujours désactivés.
- IP whitelist.
- Test connection.
- Health check.
- Revoke key.

---

## 25. Modales critiques — à créer en images

Ces écrans ne sont pas des pages complètes mais ils sont indispensables.

### Modales à créer

```text
Confirmer ordre réel
Confirmer lancement bot live
Confirmer fermeture toutes positions
Confirmer suppression stratégie
Confirmer suppression bot
Confirmer révocation API key
Confirmer activation emergency kill switch
Confirmer passage Paper vers Live
```

### Exemple : confirmation ordre réel

Contenu minimal :

```text
You are about to place a LIVE order
Pair
Side
Entry
Size
Stop Loss
Take Profit
Risk
Leverage
Estimated fees
Confirm / Cancel
```

---

## 26. États vides — à créer en images

Les états vides rendent l’application plus propre.

### États vides nécessaires

```text
Aucune watchlist
Aucune stratégie
Aucun bot
Aucun exchange connecté
Aucun trade dans le journal
Aucune alerte
Aucun ordre ouvert
Aucun backtest lancé
Aucun layout sauvegardé
```

### Exemple : aucun bot

```text
No bots yet
Create your first bot from a strategy or start from a template.
[Create Bot]
[Browse Strategies]
```

---

## 27. Écrans d’erreur — à créer en images

Le trading doit gérer les erreurs clairement.

### Erreurs à prévoir

```text
API disconnected
Insufficient balance
Order rejected
Missing stop-loss
Risk limit exceeded
Exchange unavailable
Bot stopped automatically
Invalid API permissions
IP not whitelisted
Rate limit exceeded
Slippage too high
Market closed / pair unavailable
```

### Exemple : ordre refusé par Risk Engine

```text
Order blocked
Reason:
- No stop-loss defined
- Risk estimated: 4.2%
- Max allowed: 1.0%
[Edit order]
[Cancel]
```

---

## 28. Préférences utilisateur

Les préférences doivent couvrir :

```text
Profile
Appearance
Trading Defaults
Security
Notifications
Exchange & API
Billing & Plan
Data & Privacy
Risk Rules
Trade Limits
Audit Logs
Layouts / Workspace
Keyboard Shortcuts
Advanced
```

### Profile

```text
Avatar
Name
Username
Email
Phone
Country
Language
Timezone
Main currency
Trading experience
```

### Appearance

```text
Light / Dark / System
Accent color
Chart color preset
Density
Font size
Sidebar behavior
Card radius
Animations
Reduce motion
```

### Trading Defaults

```text
Default risk per trade
Default leverage
Default order type
Preferred market type
Default slippage
Take-profit mode
Stop-loss mode
Multi-TP behavior
Break-even automation
Trailing stop defaults
Position sizing method
Default account / exchange
Quick presets
```

---

## 29. Navigation entre les pages

Toutes les pages doivent être connectées.

### Exemples de connexions

- Watchlist → Open on Chart.
- Watchlist → Add to Strategy.
- Chart → Save Setup.
- Chart → Convert to Strategy.
- Strategy → Backtest.
- Strategy → Create Bot.
- Backtest → Paper Test.
- Backtest → Create Bot.
- Bot → Open on Chart.
- Bot → Logs.
- Orders → Journal.
- Journal → Open Chart Screenshot.
- Alerts → Chart.
- API → Audit Logs.
- Risk Rules → Block Order Modal.

---

## 30. Priorité des prochaines images à créer

Nous avons déjà une bonne base. Les prochaines images les plus importantes sont :

### Priorité 1

```text
1. Strategy Detail
2. Bot Detail
3. Trade Limits
4. Audit Logs
5. Confirmation Live Order
```

### Priorité 2

```text
6. Confirmation Launch Bot Live
7. Empty State — No Bot
8. Empty State — No Exchange Connected
9. Error State — Order Blocked by Risk Engine
10. Error State — API Disconnected
```

### Priorité 3

```text
11. Keyboard Shortcuts
12. Advanced Settings
13. Multi-chart layout
14. Strategy Templates
15. Bot Logs detailed page
```

---

## 31. MVP fonctionnel recommandé

Pour que Thoon soit un succès, le MVP doit contenir seulement ce qui permet vraiment de trader proprement.

### MVP obligatoire

```text
Charts
Watchlist
Trade Markers
Position Builder
Paper Trading
Backtest
Strategy Builder
Bot Builder
Exchange & API
Orders
Alerts
Trade Journal
Risk Rules
Preferences
```

### À ne pas prioriser au début

```text
Réseau social
Marketplace
News avancées
100 indicateurs
Trop de templates
Trop d’animations
Multi-utilisateur
Copie pixel-perfect de TradingView
```

---

## 32. Ce qui rend Thoon différent

Thoon ne doit pas être un simple clone.

La vraie différence :

```text
Des outils visuels qui deviennent des actions réelles.
```

Exemples :

- Une zone dessinée peut devenir une condition de stratégie.
- Un marqueur Entry devient un ordre d’entrée.
- Un marqueur Stop Loss devient une règle de risque.
- Un setup manuel peut être transformé en stratégie.
- Une stratégie peut devenir un bot.
- Un backtest peut être rejoué en paper trading.
- Le Risk Engine peut bloquer un trade dangereux.

---

## 33. Résumé final

Thoon doit être :

```text
Épuré
Visuel
Rapide
Connecté
Sécurisé
Compréhensible
Professionnel
```

Le cœur de Thoon :

```text
Chart + Trade Markers + Position Builder + Strategy Builder + Bot Builder + Risk Engine + Exchange API
```

La prochaine étape logique est de créer les pages manquantes prioritaires :

```text
Strategy Detail
Bot Detail
Trade Limits
Audit Logs
Confirmations critiques
Empty States
Error States
```
