# Thoon — Goals Codex page par page et feature par feature

Ce fichier sert à donner à Codex une suite de **Goals clairs, ordonnés et vérifiables** pour construire l’application Thoon jusqu’à une version complète.

## Règle générale pour Codex

Pour chaque Goal, Codex doit toujours respecter :

```text
Context:
Lis README.md, PLAN.md, AGENT.md et thoon_roadmap_succes.md avant de coder.
Thoon est une application privée de trading crypto avec interface épurée, dark/light mode, charting, trade markers, stratégies, bots, API exchange, risk engine et journal de trading.

Global constraints:
- Interface épurée.
- Stack frontend par défaut : Next.js App Router avec React et TypeScript.
- Ne pas revenir à Vite ou React Router sauf demande explicite.
- Pas de texte inutile.
- Pas de fioritures.
- Ne pas surcharger les pages.
- Ne pas répéter les mêmes informations sur toutes les pages.
- Chaque page doit contenir uniquement les informations nécessaires à son usage.
- Cette application n’est pas un MVP explicatif : elle doit se comporter comme une vraie application finale.
- Ne pas afficher des explications visibles partout.
- Les explications doivent être accessibles via un bouton information, une icône info, un tooltip ou un panneau d’aide discret.
- Chaque champ complexe peut avoir une icône info cliquable pour expliquer à quoi il sert.
- Les textes d’aide doivent être cachés par défaut.
- Les labels doivent rester courts.
- Les pages doivent rester légères visuellement.
- Toutes les pages doivent être connectées entre elles.
- Garder une logique professionnelle mais compréhensible.
- Ne jamais exposer les clés API côté frontend.
- Les actions réelles de trading doivent toujours passer par confirmation et risk engine.
- Le build doit passer après chaque étape.
```

---

# Ordre de construction recommandé

## Phase 1 — Socle application

1. Setup projet
2. Layout global
3. Design system
4. Navigation
5. Thème dark/light
6. Données mockées structurées
7. Système d’aide discret
8. Routing des pages

## Phase 2 — Pages principales

8. Charts
9. Markets
10. Watchlist
11. Orders
12. Alerts
13. Preferences

## Phase 3 — Trading visuel

14. Trade Markers
15. Position Builder
16. Planned Orders
17. Save Setup
18. Confirmation Live Order

## Phase 4 — Stratégies et bots

19. Strategies List
20. Create Strategy
21. Strategy Detail
22. Backtest
23. Replay / Paper Testing
24. Bots List
25. Create Bot
26. Bot Detail
27. Bot Logs

## Phase 5 — Sécurité et exécution

28. Exchange & API
29. Risk Rules
30. Trade Limits
31. Audit Logs
32. Error States
33. Empty States

## Phase 6 — Finalisation

34. Layouts / Workspace
35. Keyboard Shortcuts
36. Advanced Settings
37. Tests globaux
38. Vérification finale application

---

# GOAL 01 — Initialiser le projet Thoon

```text
Goal:
Initialiser le projet frontend de Thoon avec une architecture propre, scalable et prête pour une application de trading.

Requirements:
- Créer ou organiser l’application avec une structure claire.
- Prévoir les dossiers components, pages/routes, layouts, hooks, services, stores, types, utils, mock-data.
- Installer ou préparer les dépendances nécessaires au frontend.
- Prévoir une base pour le design dark/light.
- Prévoir des composants UI réutilisables.
- Ajouter README.md, PLAN.md et AGENT.md comme références projet.
- Préparer un environnement de développement propre.

Constraints:
- Ne pas commencer par connecter de vrais exchanges.
- Ne pas ajouter de logique backend complexe dans cette étape.
- Ne pas créer trop de pages vides inutiles.

Done when:
- Le projet démarre correctement.
- L’architecture est claire.
- Les fichiers de référence existent.
- Le build passe.
```

---

# GOAL 02 — Créer le layout global

```text
Goal:
Créer le layout global de Thoon avec sidebar, topbar, zone de contenu et système responsive desktop.

Requirements:
- Sidebar gauche avec les entrées :
  - Charts
  - Markets
  - Watchlist
  - Backtest
  - Strategies
  - Bots
  - Orders
  - Alerts
  - History
  - Preferences
- Topbar avec :
  - logo Thoon
  - recherche paire crypto
  - timeframe
  - Indicators
  - Draw
  - Backtest
  - Strategies
  - Bots
  - toggle dark/light
  - Connect Exchange
  - Connect API
  - profil utilisateur
- Zone principale qui affiche les pages.
- Style épuré dark mode par défaut.
- Active state visible dans la navigation.

Constraints:
- Ne pas charger la topbar avec trop de texte.
- Ne pas créer plusieurs layouts concurrents.
- Ne pas dupliquer la navigation dans chaque page.

Done when:
- Toutes les pages peuvent utiliser le même layout.
- Le menu indique clairement la page active.
- Le layout reste propre et lisible.
- Le build passe.
```

---

# GOAL 03 — Créer le design system Thoon

```text
Goal:
Créer un design system minimal pour garder toute l’application cohérente.

Requirements:
- Définir les couleurs principales :
  - background dark
  - surface cards
  - border
  - primary blue
  - green profit
  - red loss/risk
  - orange warning
  - muted text
- Créer les composants :
  - Button
  - Card
  - Input
  - Select
  - Tabs
  - Table
  - Badge
  - Toggle
  - Modal
  - Tooltip
  - IconButton
  - EmptyState
  - ErrorState
- Prévoir tailles compactes.
- Prévoir état disabled, loading, active, danger.

Constraints:
- Ne pas créer un design trop décoratif.
- Ne pas utiliser trop de couleurs.
- Ne pas rendre les composants trop gros.

Done when:
- Les composants de base existent.
- Les pages peuvent les réutiliser.
- Le style est cohérent.
- Le build passe.
```


# GOAL 03B — Créer le système d’aide discret

```text
Goal:
Créer un système d’aide discret pour expliquer les éléments complexes sans remplir l’interface de texte.

Requirements:
- Créer un composant InfoButton.
- Créer un composant TooltipInfo.
- Créer un composant HelpDrawer ou HelpPopover pour les explications plus longues.
- Ajouter une icône information à côté des champs complexes :
  - Risk %
  - Leverage
  - Stop Loss
  - Take Profit
  - Break-even
  - Trailing Stop
  - Slippage
  - Fees
  - API permissions
  - IP whitelist
  - Drawdown
  - Profit factor
  - R/R
  - Emergency kill switch
- Les explications doivent être cachées par défaut.
- Les explications doivent apparaître seulement au clic ou au survol.
- Les textes doivent être courts, pratiques et directement liés à l’élément.
- Prévoir une aide contextuelle par page via un bouton “?” ou “Info”.

Constraints:
- Ne jamais afficher des blocs d’explication permanents au milieu des pages.
- Ne pas transformer Thoon en application tutoriel.
- Ne pas ajouter des paragraphes longs dans l’interface principale.
- Les utilisateurs avancés doivent pouvoir ignorer totalement l’aide.
- L’aide doit être discrète et non intrusive.

Done when:
- Les composants d’aide existent.
- Les champs complexes utilisent une icône info.
- Les pages restent épurées sans texte visible inutile.
- Le build passe.
```

---

# GOAL 04 — Créer le système de thème dark/light

```text
Goal:
Créer un système de thème dark/light pour Thoon.

Requirements:
- Toggle visible dans la topbar.
- Mode dark par défaut.
- Mode light disponible.
- Option system si possible.
- Persistance du thème dans localStorage ou préférence utilisateur.
- Les composants doivent suivre le thème.
- Les charts et panneaux doivent rester lisibles dans les deux modes.

Constraints:
- Ne pas recréer deux interfaces séparées.
- Ne pas rendre le light mode trop blanc agressif.
- Ne pas casser les contrastes.

Done when:
- L’utilisateur peut changer le thème.
- Le thème reste après refresh.
- Les pages principales restent lisibles.
- Le build passe.
```

---

# GOAL 05 — Créer les données mockées de base

```text
Goal:
Créer les données mockées nécessaires pour construire les pages sans backend réel.

Requirements:
- mock markets
- mock watchlists
- mock positions
- mock orders
- mock alerts
- mock strategies
- mock bots
- mock journal trades
- mock exchanges
- mock API keys
- mock risk rules
- mock audit logs
- mock user profile
- Créer des types TypeScript si le projet utilise TypeScript.

Constraints:
- Ne pas mettre de vraies clés API.
- Ne pas faire croire que les données sont réelles.
- Ne pas mélanger données mockées et logique d’exécution réelle.

Done when:
- Toutes les pages peuvent afficher des données.
- Les mocks sont organisés.
- Les types sont cohérents.
- Le build passe.
```

---

# GOAL 06 — Créer le routing complet

```text
Goal:
Créer toutes les routes principales de Thoon.

Routes:
- /charts
- /markets
- /watchlist
- /backtest
- /strategies
- /strategies/new
- /strategies/:id
- /bots
- /bots/new
- /bots/:id
- /orders
- /alerts
- /history
- /preferences
- /preferences/profile
- /preferences/appearance
- /preferences/trading-defaults
- /preferences/security
- /preferences/notifications
- /preferences/exchange-api
- /preferences/billing
- /preferences/data-privacy
- /preferences/risk-rules
- /preferences/trade-limits
- /preferences/audit-logs
- /preferences/layouts
- /preferences/keyboard-shortcuts
- /preferences/advanced

Constraints:
- Ne pas créer de routes inutiles.
- Les routes doivent utiliser le layout global.
- Les pages non finalisées peuvent avoir une structure minimale mais propre.

Done when:
- Toutes les routes sont accessibles depuis le menu ou les actions.
- Les liens ne cassent pas.
- Le build passe.
```

---

# GOAL 07 — Page Charts principale

```text
Goal:
Construire la page Charts principale de Thoon.

Requirements:
- Afficher un chart principal en chandeliers.
- Afficher volume.
- Afficher paire active, timeframe, OHLC.
- Afficher barre d’outils verticale.
- Afficher panneau Position Builder à droite.
- Afficher planned orders en bas.
- Afficher notes de scénario.
- Afficher boutons Create Alert, Save Setup, Execute Trade.
- Prévoir Paper Trade / Live Trade.
- Prévoir bouton settings chart, fullscreen, screenshot.

Constraints:
- Ne pas surcharger le chart.
- Ne pas mettre trop de texte explicatif.
- Les informations critiques doivent être visibles.
- Les outils doivent être faciles à comprendre.

Done when:
- La page Charts ressemble à un cockpit de trading propre.
- Les sections principales sont présentes.
- Le layout est cohérent avec Thoon.
- Le build passe.
```

---

# GOAL 08 — Intégrer un chart fonctionnel

```text
Goal:
Intégrer un chart fonctionnel avec données OHLCV mockées ou API locale.

Requirements:
- Candlesticks.
- Volume.
- Timeframes.
- Crosshair.
- Zoom/pan.
- Affichage du prix courant.
- Affichage des lignes Entry/Stop/TP si disponibles.
- Support du dark/light mode.

Constraints:
- Utiliser une bibliothèque autorisée et respecter sa licence.
- Ne pas utiliser de capture ou composant propriétaire non autorisé.
- Ne pas bloquer l’application si les données manquent.

Done when:
- Le chart affiche des candles.
- Les données changent quand la paire ou timeframe change.
- Les overlays de trading peuvent être dessinés.
- Le build passe.
```

---

# GOAL 09 — Page Markets

```text
Goal:
Créer la page Markets pour explorer les cryptos et tendances.

Requirements:
- Cartes statistiques :
  - Market Cap
  - 24h Volume
  - BTC Dominance
  - ETH Dominance
  - Active Cryptos
- Catégories :
  - All
  - Trending
  - DeFi
  - Layer 1
  - Meme
  - AI
- Heatmap marché.
- Top Movers.
- Market Sentiment.
- Table cryptos :
  - Symbol
  - Name
  - Price
  - 24h %
  - 24h Volume
  - Market Cap
  - Favorite
  - Actions

Actions:
- Ouvrir sur chart.
- Ajouter à watchlist.
- Ajouter à stratégie.
- Créer alerte.

Constraints:
- Ne pas transformer Markets en page de news.
- Garder une interface de découverte rapide.
- Ne pas afficher trop de métriques secondaires.

Done when:
- L’utilisateur peut explorer le marché.
- Il peut ouvrir une crypto sur le chart.
- Il peut l’ajouter à une watchlist ou stratégie.
- Le build passe.
```

---

# GOAL 10 — Page Watchlist

```text
Goal:
Créer la page Watchlist complète.

Requirements:
- Onglets :
  - Mes listes
  - Favoris
  - Paires suivies
- Section Mes listes avec :
  - listes personnalisées
  - compteur de paires
  - bouton Nouvelle liste
  - gérer les listes
- Tableau avec :
  - Pair
  - Prix
  - Variation
  - Volume
  - Alertes actives
  - Actions
- Actions par ligne :
  - Ouvrir sur chart
  - Ajouter à stratégie
- Recherche.
- Filtres Spot / Perp / Favoris / Avec alertes.
- Tri par prix, variation, volume, alertes.

Constraints:
- Ne pas répéter les données Markets inutilement.
- Watchlist doit être orientée suivi personnel.
- Garder les actions visibles.

Done when:
- Les trois onglets existent.
- Les listes sont affichées.
- Les actions fonctionnent visuellement.
- Le build passe.
```

---

# GOAL 11 — Connecter Watchlist vers Chart et Strategy

```text
Goal:
Connecter les actions de Watchlist aux autres pages.

Requirements:
- Bouton Ouvrir sur chart :
  - change la paire active
  - redirige vers /charts
- Bouton Ajouter à stratégie :
  - ouvre un modal ou redirige vers /strategies/new avec la paire pré-remplie
- Favori :
  - ajoute ou retire une paire des favoris
- Alertes actives :
  - lien vers /alerts filtré par paire

Constraints:
- Ne pas créer de backend complexe dans cette étape.
- Si nécessaire, utiliser store local ou mock state.
- Ne pas perdre la paire active au refresh si possible.

Done when:
- Watchlist est connectée à Charts.
- Watchlist est connectée à Strategies.
- Les actions sont compréhensibles.
- Le build passe.
```

---

# GOAL 12 — Page Orders

```text
Goal:
Créer la page Orders pour gérer positions, ordres et historique.

Requirements:
- Account Summary :
  - Balance
  - Unrealized PnL
  - Realized PnL
  - Margin Used
  - Available Balance
- Tabs :
  - Open Positions
  - Open Orders
  - History
  - Fills
- Open Positions table :
  - Symbol
  - Side
  - Size
  - Entry Price
  - Mark Price
  - PnL
  - Margin
  - TP/SL
  - Status
  - Opened
  - Action
- Open Orders table.
- Recent Fills.
- Order History.
- Actions :
  - Close
  - Cancel
  - Close All
  - Export

Constraints:
- Ne pas exécuter d’ordre réel ici.
- Toute action réelle doit passer par confirmation.
- Garder la page lisible malgré les tableaux.

Done when:
- Les positions et ordres sont visibles.
- Les actions critiques sont présentes.
- Le build passe.
```

---

# GOAL 13 — Page Alerts

```text
Goal:
Créer la page Alerts pour gérer les alertes de trading.

Requirements:
- Tabs :
  - All Alerts
  - Price
  - Zone
  - Indicator
  - Strategy
  - Bot
- Formulaire Create New Alert :
  - Market
  - Alert Type
  - Condition
  - Price / Zone / Indicator
  - Trigger once/repeat
  - Notify via App, Email, Webhook
- Active Alerts table.
- Triggered Alerts table.
- Actions :
  - enable/disable
  - edit
  - delete
  - replay/open chart
- Alert Log button.

Constraints:
- Garder la création simple.
- Ne pas afficher des explications longues.
- Les alertes bot/strategy doivent être distinguées clairement.

Done when:
- L’utilisateur peut créer et gérer une alerte.
- Les alertes actives et déclenchées sont visibles.
- Le build passe.
```

---

# GOAL 14 — Page Preferences générale

```text
Goal:
Créer la page Preferences et sa navigation interne.

Requirements:
Sidebar interne Preferences :
- Profile
- Appearance
- Trading Defaults
- Security
- Notifications
- Exchange & API
- Billing & Plan
- Data & Privacy
- Risk Rules
- Trade Limits
- Audit Logs
- Layouts / Workspace
- Keyboard Shortcuts
- Advanced

Cards de résumé :
- Profile summary.
- Appearance summary.
- Trading Defaults summary.
- Security summary.
- Notifications summary.
- Exchange/API summary.
- Billing summary.
- Data & Privacy summary.

Constraints:
- Ne pas répéter toute l’information des sous-pages.
- La page générale doit servir de résumé et accès rapide.
- Garder une présentation compacte.

Done when:
- Toutes les sections Preferences sont accessibles.
- La page générale donne un aperçu utile.
- Le build passe.
```

---

# GOAL 15 — Preferences Profile

```text
Goal:
Créer la page Profile dans Preferences.

Requirements:
- Avatar.
- Name.
- Username.
- Email.
- Phone.
- Country.
- Language.
- Timezone.
- Main currency.
- Trading experience.
- Plan badge.
- Save changes.

Constraints:
- Ne pas demander des infos inutiles.
- Ne pas afficher de données sensibles.
- Garder la page propre.

Done when:
- L’utilisateur peut voir et modifier ses informations.
- Les champs principaux sont présents.
- Le build passe.
```

---

# GOAL 16 — Preferences Appearance

```text
Goal:
Créer la page Appearance.

Requirements:
- Theme : Light / Dark / System.
- Accent color.
- Chart color preset.
- Density : Compact / Comfortable / Spacious.
- Font size : Small / Medium / Large.
- Sidebar behavior.
- Card radius.
- Enable animations.
- Reduce motion.
- Preview light/dark.

Constraints:
- Les changements doivent se voir immédiatement si possible.
- Ne pas ajouter trop d’options visuelles.
- Garder la cohérence Thoon.

Done when:
- L’utilisateur peut personnaliser l’apparence.
- Le thème fonctionne.
- Le build passe.
```

---

# GOAL 17 — Preferences Trading Defaults

```text
Goal:
Créer la page Trading Defaults.

Requirements:
- Default Risk per Trade.
- Default Leverage.
- Default Order Type.
- Preferred Market Type : Spot / Perpetual / Futures.
- Default Slippage.
- Take-Profit Mode.
- Stop-Loss Mode.
- Multi-TP Behavior.
- Break-Even Automation.
- Trailing Stop Defaults.
- Position Sizing Method.
- Default Account / Exchange.
- Quick Presets :
  - Scalping
  - Day Trading
  - Swing Trading
  - Position Trading
  - Custom
- Order Panel Preview.

Constraints:
- Les valeurs par défaut doivent être utilisées par Position Builder.
- Ne pas rendre la page trop technique pour un débutant.
- Ajouter tooltips courts si nécessaire.

Done when:
- Les préférences sont modifiables.
- Le preview reflète les paramètres.
- Le build passe.
```

---

# GOAL 18 — Preferences Security

```text
Goal:
Créer la page Security.

Requirements:
- Security status.
- 2FA status.
- Active sessions count.
- Last login.
- Authentication :
  - Password
  - Two-Factor Authentication
  - Authenticator App
  - Backup Codes
- Access & Sessions :
  - Device Management
  - Active Sessions
  - Login History
  - IP Allowlist
- API Security :
  - API permissions
  - IP restrictions
- Additional Security :
  - Biometric unlock
- Danger Zone :
  - Deactivate account
  - Delete account

Constraints:
- Actions sensibles doivent demander confirmation.
- Ne pas afficher mots de passe ou secrets.
- Garder une hiérarchie claire.

Done when:
- Les blocs sécurité sont visibles.
- Les actions sensibles sont identifiées.
- Le build passe.
```

---

# GOAL 19 — Preferences Notifications

```text
Goal:
Créer la page Notifications.

Requirements:
- App Notifications.
- Email Notifications.
- Push Notifications.
- Sound Alerts.
- Webhook Alerts.
- Trade Execution Notices.
- Bot Alerts.
- Strategy Alerts.
- Security Alerts.
- Digest Frequency.
- Quiet Hours.
- Notification Channel Testing.
- Recent Notification Preview.

Constraints:
- Ne pas créer un centre de notification trop lourd.
- Les toggles doivent être clairs.
- Les alertes trading doivent rester prioritaires.

Done when:
- Les canaux de notification sont configurables.
- Les tests de notification sont visibles.
- Le build passe.
```

---

# GOAL 20 — Preferences Billing & Plan

```text
Goal:
Créer la page Billing & Plan.

Requirements:
- Plans :
  - Free
  - Pro
  - Elite
- Current subscription.
- Billing period.
- Status.
- Next renewal.
- Amount.
- Usage & Limits :
  - Exchange connections
  - Bot slots
  - Backtest credits
- Payment method.
- Billing summary.
- Invoices.
- Billing history.
- Manage plan.
- Cancel subscription.
- Download invoice.

Constraints:
- Ne pas connecter un vrai paiement dans cette étape si ce n’est pas prévu.
- Ne pas afficher de vraie donnée bancaire.
- Garder la page claire.

Done when:
- Les informations de plan sont visibles.
- Les limites sont compréhensibles.
- Le build passe.
```

---

# GOAL 21 — Preferences Data & Privacy

```text
Goal:
Créer la page Data & Privacy.

Requirements:
- Privacy summary.
- Export my data.
- Download reports.
- Privacy controls.
- Analytics consent.
- Personalized experience.
- Cookies & tracking.
- Data retention.
- Connected apps.
- Activity logs.
- Regional privacy options.
- Delete account.

Constraints:
- Les actions de suppression doivent demander confirmation.
- Ne pas ajouter de jargon inutile.
- Garder la page rassurante et claire.

Done when:
- Les contrôles de données sont visibles.
- Export et Delete Account sont présents.
- Le build passe.
```

---

# GOAL 22 — Trade Markers sur la page Charts

```text
Goal:
Créer l’onglet Trade Markers sur la page Charts.

Requirements:
- Ajouter un panneau séparé des outils Draw.
- Instruments disponibles :
  - Entry
  - Exit
  - Stop Loss
  - Take Profit
  - TP2
  - Buy Limit
  - Sell Limit
  - Alert
- Chaque instrument est draggable.
- Chaque instrument peut être posé sur le chart.
- Chaque marqueur posé crée une ligne horizontale et un label prix.
- Les marqueurs restent déplaçables.
- Le panneau Position Builder se met à jour automatiquement.
- Couleurs :
  - Entry bleu
  - Exit violet
  - Stop Loss rouge
  - Take Profit vert
  - Alert jaune
  - Limit cyan/orange

Constraints:
- Ne pas mélanger avec Draw Tools.
- Ne pas rendre le chart illisible.
- Le panneau doit rester à portée de main.
- Les interactions doivent être simples.

Done when:
- L’utilisateur peut poser Entry, Stop Loss, Take Profit.
- Le prix des marqueurs est synchronisé.
- Le risk/reward est recalculé.
- Le build passe.
```

---

# GOAL 23 — Position Builder complet

```text
Goal:
Créer le Position Builder complet et synchronisé avec les Trade Markers.

Requirements:
- Pair.
- Direction Long / Short.
- Entry.
- Stop Loss.
- Take Profit.
- Multi-TP.
- Risk / Reward.
- Potential Profit.
- Potential Loss.
- Risk %.
- Position Size.
- Leverage.
- Fees.
- Break-even.
- Trailing Stop.
- Paper Trade / Live Trade toggle.
- Execute Trade.
- Create Alert.
- Save Setup.

Interactions:
- Modifier un champ met à jour le chart.
- Déplacer un marqueur met à jour le champ.
- Changer Risk % recalcule la taille.
- Changer leverage recalcule marge/liquidation si disponible.

Constraints:
- Ne pas forcer l’utilisateur à remplir manuellement ce qui peut être visuel.
- Les valeurs critiques doivent être lisibles.
- Live Trade doit passer par confirmation.

Done when:
- Le Position Builder est complet.
- La synchronisation chart/panel fonctionne.
- Le build passe.
```

---

# GOAL 24 — Planned Orders et Save Setup

```text
Goal:
Créer les Planned Orders et la sauvegarde de setup.

Requirements:
- Planned Orders list :
  - Limit
  - Take Profit
  - Stop Loss
  - Buy/Sell
  - Price
  - Size
  - Status
- Bouton Add Order.
- Bouton Save Setup.
- Setup sauvegardé avec :
  - pair
  - timeframe
  - markers
  - planned orders
  - notes
  - risk settings
- Les setups peuvent être rechargés.

Constraints:
- Ne pas exécuter automatiquement les planned orders.
- Save Setup doit être différent d’Execute Trade.
- Garder la liste compacte.

Done when:
- L’utilisateur peut préparer plusieurs ordres.
- Il peut sauvegarder un setup.
- Le build passe.
```

---

# GOAL 25 — Confirmation Live Order

```text
Goal:
Créer une modale de confirmation avant tout ordre réel.

Requirements:
Modal title:
- Confirm Live Order

Afficher :
- Pair
- Side
- Order type
- Entry
- Size
- Stop Loss
- Take Profit
- Risk %
- Potential Loss
- Potential Profit
- Leverage
- Estimated Fees
- Exchange
- Account

Actions:
- Cancel
- Confirm Live Order

Risk Engine warning:
- Si stop-loss absent, bloquer.
- Si risque dépassé, bloquer.
- Si exchange déconnecté, bloquer.
- Si solde insuffisant, bloquer.

Constraints:
- La confirmation est obligatoire pour Live Trade.
- Paper Trade ne doit pas demander une confirmation aussi lourde.
- Ne pas permettre Confirm si une règle critique échoue.

Done when:
- Toute exécution live ouvre cette modale.
- Les règles de blocage sont visibles.
- Le build passe.
```

---

# GOAL 26 — Exchange & API

```text
Goal:
Créer la page Exchange & API complète.

Requirements:
- Supported Exchanges :
  - Binance
  - Bybit
  - OKX
  - Bitget
  - Kraken
  - KuCoin
  - Coinbase Advanced
- Add API Key form :
  - Exchange
  - Key Name
  - API Key
  - Secret Key
  - Passphrase optional
  - Permissions Read / Trade
  - IP Whitelist
  - Test Connection
  - Save Key
- Connection Health :
  - status
  - latency
  - last check
  - total connected
  - webhooks
  - recent activity
- API documentation link.
- Revoke key actions.

Constraints:
- Ne jamais afficher les secrets en clair après sauvegarde.
- Ne jamais activer retrait.
- Ne pas connecter de vraie API si le backend n’est pas prêt.
- Prévoir état mock/sandbox.

Done when:
- L’utilisateur peut configurer une connexion API visuellement.
- Test Connection et Save Key sont présents.
- Le build passe.
```

---

# GOAL 27 — Risk Rules

```text
Goal:
Créer la page Risk Rules.

Requirements:
- Maximum Risk Per Trade.
- Daily Loss Limit.
- Weekly Loss Limit.
- Maximum Leverage.
- Block Live Orders Without Stop-Loss.
- Stop Bots At Max Drawdown.
- Confirm Before Real Orders.
- Allowed Trading Session Hours.
- Bot Pause After Loss Streak.
- Emergency Kill Switch.
- Account Protection Rules.
- Minimum Balance.
- Risk Protection Summary.
- Save Rules.

Constraints:
- Les règles doivent être utilisées par Position Builder, Bots et Orders.
- Emergency Kill Switch doit demander confirmation.
- Ne pas cacher les règles importantes.

Done when:
- Les règles globales sont configurables.
- Le résumé de protection est clair.
- Le build passe.
```

---

# GOAL 28 — Trade Limits

```text
Goal:
Créer la page Trade Limits.

Requirements:
- Max orders per day.
- Max orders per hour.
- Max open positions.
- Max position size per pair.
- Max total exposure.
- Max bot slots active.
- Max strategy executions per day.
- Max API errors before pause.
- Cooldown after losing trade.
- Cooldown after bot error.
- Per-market limits.
- Save Limits.
- Reset to Defaults.

Constraints:
- Trade Limits complète Risk Rules sans la dupliquer.
- Garder une structure en cartes simples.
- Les limites doivent être applicables aux bots et trades manuels.

Done when:
- La page Trade Limits existe.
- Les limites opérationnelles sont modifiables.
- Le build passe.
```

---

# GOAL 29 — Strategies List

```text
Goal:
Créer la page Strategies list.

Requirements:
- Search strategies.
- Filter All / Active / Draft / Archived.
- Sort by recent/performance/name.
- Table/list with :
  - Strategy
  - Type
  - Market
  - Timeframe
  - Status
  - Performance 30D
  - Actions
- Actions :
  - play/test
  - duplicate
  - edit
  - more
- New Strategy button.
- Right side quick builder optional.

Constraints:
- Ne pas afficher trop de détails sur la liste.
- Les détails doivent être dans Strategy Detail.
- Garder la page rapide à scanner.

Done when:
- Les stratégies sont listées.
- Les actions principales sont visibles.
- Le build passe.
```

---

# GOAL 30 — Create Strategy

```text
Goal:
Créer la page New Strategy.

Requirements:
- Strategy Name.
- Market / Pair.
- Timeframe.
- Strategy Type.
- Entry Conditions :
  - IF
  - AND / OR
  - indicator/price selector
  - operator
  - value
  - Add Condition
  - Add Group
- Exit Conditions.
- Risk Settings :
  - Risk per trade
  - Account balance
  - Position sizing
  - Max open trades
  - Stop Loss
  - Take Profit
  - Trailing Stop
  - R/R target
  - Stop-loss required
- Actions :
  - Save
  - Backtest
  - Create Bot

Constraints:
- Ne pas rendre le builder trop complexe.
- Les blocs doivent être lisibles.
- Les conditions doivent être réutilisables pour bots/backtests.

Done when:
- L’utilisateur peut créer une stratégie visuellement.
- Les conditions sont claires.
- Le build passe.
```

---

# GOAL 31 — Strategy Detail

```text
Goal:
Créer la page Strategy Detail.

Requirements:
- Strategy name.
- Status.
- Market / Pair.
- Timeframe.
- Strategy Type.
- Current performance.
- Linked bots.
- Backtest summary.
- Entry conditions.
- Exit conditions.
- Risk rules.
- Version history.
- Last updated.
- Notes.

Tabs:
- Overview.
- Conditions.
- Backtests.
- Bots.
- Versions.
- Settings.

Actions:
- Edit.
- Duplicate.
- Backtest.
- Create Bot.
- Archive.
- Delete.
- Open on Chart.

Constraints:
- Ne pas répéter toute la liste Strategies.
- Cette page doit expliquer clairement ce que fait une stratégie.
- Suppression/Archive doivent demander confirmation.

Done when:
- Une stratégie existante est consultable.
- Ses conditions et performances sont visibles.
- Le build passe.
```

---

# GOAL 32 — Backtest

```text
Goal:
Créer la page Backtest.

Requirements:
- Inputs :
  - Symbol
  - Timeframe
  - Date Range
  - Initial Capital
  - Fees
  - Slippage
  - Strategy
- Equity Curve.
- Performance Summary :
  - Net Profit
  - Total Return
  - Win Rate
  - Profit Factor
  - Max Drawdown
  - Total Trades
  - Winning Trades
  - Losing Trades
- Equity & Drawdown chart.
- Trade list.
- Tabs :
  - Trades
  - Monthly Returns
  - Equity Distribution
  - Drawdown
  - Chart Analysis
- Actions :
  - Run Backtest
  - Save Report
  - Paper Test

Constraints:
- Ne pas faire croire à une vraie performance si les données sont mockées.
- Garder le rapport clair.
- Backtest doit pouvoir recevoir une strategyId.

Done when:
- Un backtest peut être lancé visuellement.
- Les résultats s’affichent.
- Le build passe.
```

---

# GOAL 33 — Replay / Paper Testing

```text
Goal:
Créer la page Replay / Paper Testing.

Requirements:
- Market / Pair.
- Time Range.
- Starting Capital.
- Fees.
- Slippage.
- Chart avec futur caché.
- Replay controls :
  - play
  - pause
  - speed
  - step back/forward
  - date cursor
- Paper Trading panel :
  - balance
  - equity
  - unrealized PnL
  - Buy
  - Sell
  - Close
  - Market / Limit / Stop
- Paper Trade Log.
- Export.

Constraints:
- Replay ne doit pas placer d’ordres réels.
- Le futur doit être clairement marqué hidden.
- L’interface doit rester simple.

Done when:
- L’utilisateur peut simuler des trades.
- Le log de paper trades se remplit.
- Le build passe.
```

---

# GOAL 34 — Bots List

```text
Goal:
Créer la page Bots list.

Requirements:
- Summary cards :
  - Active Bots
  - Total PnL
  - Win Rate
  - Active Alerts
- Search bots.
- Filters.
- Table :
  - Name
  - Strategy
  - Exchange
  - Symbol
  - Mode
  - Status
  - Actions
- Actions :
  - pause/resume
  - stop
  - edit
  - logs/details
- Right detail preview for selected bot.
- Create Bot button.

Constraints:
- Ne pas mélanger création et monitoring.
- La liste doit être claire.
- Les actions stop/pause doivent être visibles.

Done when:
- Les bots sont listés.
- On peut sélectionner un bot.
- Le build passe.
```

---

# GOAL 35 — Create Bot

```text
Goal:
Créer la page Create Bot.

Requirements:
- Bot Name.
- Strategy.
- Exchange.
- Market / Pair.
- Mode Paper / Live.
- Status.
- Allocated Capital.
- Risk Per Trade.
- Max Daily Loss.
- Leverage Max.
- Max Concurrent Trades.
- Schedule / Active Hours.
- Entry Source / Strategy Source.
- Stop Bot on Drawdown.
- Require Stop-Loss on All Trades.
- Bot Preview.
- Launch Bot.
- Save Draft.
- Recent Events.

Constraints:
- Mode Live doit nécessiter confirmation.
- Si exchange non connecté, bloquer Launch Live.
- Si stop-loss non requis, afficher warning.
- Ne pas exécuter réellement sans backend sécurisé.

Done when:
- L’utilisateur peut configurer un bot.
- Le preview est clair.
- Le build passe.
```

---

# GOAL 36 — Confirmation Launch Bot Live

```text
Goal:
Créer une modale de confirmation pour lancer un bot en Live.

Requirements:
Afficher :
- Bot name.
- Strategy.
- Exchange.
- Pair.
- Mode Live.
- Allocated capital.
- Risk per trade.
- Max daily loss.
- Max leverage.
- Stop-loss required.
- Daily/weekly risk rules.
- API permission status.
- Warning live trading.

Actions:
- Cancel.
- Confirm Launch Live Bot.

Blockers:
- Exchange disconnected.
- API lacks trade permission.
- Stop-loss not required.
- Risk rules not configured.
- Max daily loss missing.

Constraints:
- Ne jamais lancer live sans confirmation.
- Les warnings doivent être nets.
- Pas de texte long, mais les risques doivent être visibles.

Done when:
- Launch Bot en mode live ouvre la modale.
- Les blockers empêchent la confirmation.
- Le build passe.
```

---

# GOAL 37 — Bot Detail

```text
Goal:
Créer la page Bot Detail.

Requirements:
Header:
- Bot name.
- Bot ID.
- Status.
- Mode Paper/Live.
- Exchange.
- Strategy.
- Market / Pair.

Overview:
- Capital allocated.
- Current position.
- Unrealized PnL.
- Realized PnL.
- Win rate.
- Max drawdown.
- Last signal.
- Last trade.
- Connection status.
- API status.

Tabs:
- Overview.
- Performance.
- Positions.
- Logs.
- Settings.

Actions:
- Pause Bot.
- Resume Bot.
- Stop Bot.
- Edit Bot.
- Open on Chart.
- Open Backtest.
- Export Logs.

Constraints:
- Stop/Pause actions doivent demander confirmation si live.
- Ne pas répéter toute la page Bots.
- Logs doivent être accessibles facilement.

Done when:
- Un bot actif est consultable en détail.
- Ses actions sont disponibles.
- Le build passe.
```

---

# GOAL 38 — Bot Logs détaillés

```text
Goal:
Créer la page ou l’onglet Bot Logs détaillé.

Requirements:
- Timeline de logs.
- Filtres :
  - signal
  - order
  - error
  - risk
  - API
  - system
- Colonnes :
  - time
  - event
  - pair
  - action
  - status
  - details
- Événements :
  - signal detected
  - order sent
  - order filled
  - stop moved
  - bot paused
  - bot resumed
  - API error
  - risk rule blocked order
- Export logs.

Constraints:
- Ne pas afficher de secrets API.
- Les erreurs doivent être lisibles.
- Les logs doivent aider à comprendre ce que fait le bot.

Done when:
- Les logs du bot sont consultables.
- Les filtres fonctionnent visuellement.
- Le build passe.
```

---

# GOAL 39 — Trade Journal

```text
Goal:
Créer la page Trade Journal.

Requirements:
- Tabs :
  - All Trades
  - Manual
  - Bot
  - Paper
- Filters :
  - date range
  - pair
  - source
  - result
- Table :
  - Date & Time
  - Pair
  - Side
  - Source
  - Result
  - R/R
  - PnL
  - Tag
- Performance Summary :
  - Win Rate
  - Avg R Multiple
  - Total PnL
  - Best Trade
  - Worst Trade
  - Expectancy
- Best Setup card.
- Trade Details panel.
- Screenshot preview.
- Notes.
- Mistakes & Lessons.
- Actions :
  - Edit
  - Duplicate
  - Delete
  - View Chart

Constraints:
- Ne pas transformer le journal en dashboard trop lourd.
- Les notes doivent être utiles.
- Les screenshots ne doivent pas surcharger la liste.

Done when:
- Les trades sont consultables et filtrables.
- Le détail d’un trade est visible.
- Le build passe.
```

---

# GOAL 40 — Audit Logs

```text
Goal:
Créer la page Audit Logs.

Requirements:
- Search logs.
- Filters :
  - event type
  - user/system/bot
  - exchange
  - pair
  - status
  - date range
- Table :
  - Date / Time
  - Event Type
  - Source
  - Exchange
  - Pair
  - Action
  - Status
  - IP Address
  - Details
- Events :
  - API key created
  - API key modified
  - API key revoked
  - order sent
  - order rejected
  - order cancelled
  - position closed
  - bot launched
  - bot paused
  - bot stopped
  - strategy modified
  - risk rule modified
  - emergency kill switch enabled
  - exchange error
  - login failed
- Export logs.

Constraints:
- Ne pas afficher d’informations sensibles.
- Les logs doivent être précis.
- Audit Logs doit être accessible depuis Preferences et API.

Done when:
- Les événements sont listés.
- Les filtres sont visibles.
- Le build passe.
```

---

# GOAL 41 — Empty States

```text
Goal:
Créer les empty states de Thoon.

Required empty states:
- Aucune watchlist.
- Aucune stratégie.
- Aucun bot.
- Aucun exchange connecté.
- Aucun trade dans le journal.
- Aucune alerte.
- Aucun ordre ouvert.
- Aucun backtest lancé.
- Aucun layout sauvegardé.

Each empty state must include:
- Icône simple.
- Titre court.
- Description courte.
- Action principale.
- Action secondaire si utile.

Examples:
- No bots yet → Create Bot / Browse Strategies.
- No exchange connected → Connect Exchange / Add API Key.
- No strategy → Create Strategy / Use Template.

Constraints:
- Pas de longs textes.
- Les empty states doivent guider l’utilisateur.
- Style cohérent.

Done when:
- Les principales pages affichent un empty state propre si données vides.
- Le build passe.
```

---

# GOAL 42 — Error States

```text
Goal:
Créer les error states critiques de Thoon.

Required errors:
- API disconnected.
- Insufficient balance.
- Order rejected.
- Missing stop-loss.
- Risk limit exceeded.
- Exchange unavailable.
- Bot stopped automatically.
- Invalid API permissions.
- IP not whitelisted.
- Rate limit exceeded.
- Slippage too high.
- Market unavailable.

Each error must include:
- Titre clair.
- Raison.
- Action corrective.
- Option cancel/close.
- Lien vers page concernée si utile.

Example:
Order blocked by Risk Engine:
- No stop-loss defined.
- Risk estimated 4.2%.
- Max allowed 1.0%.
- Actions: Edit Order / Cancel.

Constraints:
- Pas d’erreurs vagues.
- Ne pas paniquer l’utilisateur.
- Les erreurs de trading doivent être précises.

Done when:
- Les erreurs critiques sont prévues.
- Le Risk Engine peut utiliser ces états.
- Le build passe.
```

---

# GOAL 43 — Layouts / Workspace

```text
Goal:
Créer la page Layouts / Workspace.

Requirements:
- Saved Layouts :
  - Single Chart
  - Multi-Chart
  - Bot Monitor
  - Backtest Lab
  - Trade Journal
  - Custom Layout
- Actions :
  - Save Current Layout
  - Import Layout
  - Apply
  - Duplicate
  - Edit
  - Delete
- Workspace Preview.
- Workspace Settings :
  - Primary Chart visible
  - Order Panel visible
  - Watchlist collapsed/visible
  - Bottom Panel visible
  - Right Panel visible
  - Alerts Panel hidden/visible
  - News Feed hidden/visible
- Workspace Controls :
  - Set Default Workspace
  - Reset Layout
  - Sidebar Behavior
  - Panel Docking
  - Widget Visibility

Constraints:
- Layouts doivent aider, pas compliquer.
- Garder les cartes visuelles.
- Appliquer un layout doit changer l’interface.

Done when:
- L’utilisateur peut gérer ses layouts.
- Un layout peut être appliqué.
- Le build passe.
```

---

# GOAL 44 — Keyboard Shortcuts

```text
Goal:
Créer la page Keyboard Shortcuts.

Requirements:
- Liste des raccourcis par catégorie :
  - Navigation
  - Chart
  - Trade Markers
  - Orders
  - Bots
  - Backtest
- Permettre de voir et modifier un raccourci.
- Bouton reset shortcuts.
- Détection conflits.
- Toggle enable shortcuts.

Suggested shortcuts:
- C → Charts
- W → Watchlist
- B → Backtest
- S → Strategies
- Alt + E → Entry marker
- Alt + X → Exit marker
- Alt + L → Stop Loss marker
- Alt + T → Take Profit marker
- Ctrl/Cmd + S → Save Setup

Constraints:
- Ne pas imposer trop de raccourcis.
- Les raccourcis critiques ne doivent pas exécuter un ordre réel directement.
- Toute action live reste confirmée.

Done when:
- La page existe.
- Les raccourcis sont listés.
- Le build passe.
```

---

# GOAL 45 — Advanced Settings

```text
Goal:
Créer la page Advanced Settings.

Requirements:
- Developer / Debug mode.
- Data refresh interval.
- Chart performance settings.
- Cache controls.
- Experimental features.
- API retry behavior.
- WebSocket reconnect behavior.
- Local data reset.
- Export app config.
- Import app config.

Constraints:
- Page réservée aux réglages avancés.
- Ne pas mélanger avec Trading Defaults.
- Les actions destructives doivent demander confirmation.

Done when:
- Les paramètres avancés sont présents.
- Les actions sensibles sont protégées.
- Le build passe.
```

---

# GOAL 46 — Connexions internes entre pages

```text
Goal:
Connecter les pages entre elles selon la logique produit Thoon.

Required connections:
- Watchlist → Open on Chart.
- Watchlist → Add to Strategy.
- Markets → Open on Chart.
- Markets → Add to Watchlist.
- Chart → Save Setup.
- Chart → Convert to Strategy.
- Chart → Create Alert.
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

Constraints:
- Ne pas créer de liens morts.
- Les données transmises doivent être simples.
- Utiliser route params ou store local.

Done when:
- Les actions principales redirigent correctement.
- Les pages sont réellement connectées.
- Le build passe.
```

---

# GOAL 47 — Risk Engine logique frontend

```text
Goal:
Créer une première logique frontend du Risk Engine.

Requirements:
Risk Engine must check:
- stop-loss required.
- max risk per trade.
- daily loss limit.
- weekly loss limit.
- max leverage.
- minimum balance.
- exchange connected.
- API trade permission.
- max open positions.
- max orders per day.
- bot drawdown limit.

Outputs:
- allowed true/false.
- list of warnings.
- list of blockers.
- suggested correction.
- severity.

Use cases:
- Execute Trade.
- Launch Live Bot.
- Create Bot.
- Planned Orders.
- Strategy execution preview.

Constraints:
- Ne pas remplacer le futur backend risk engine.
- Ne pas autoriser Live si blocker critique.
- Les messages doivent être clairs.

Done when:
- Position Builder utilise Risk Engine.
- Launch Bot utilise Risk Engine.
- Confirmation Live Order affiche les blockers.
- Le build passe.
```

---

# GOAL 48 — Accessibilité et responsive

```text
Goal:
Améliorer l’accessibilité et le responsive desktop/tablette de Thoon.

Requirements:
- Contrastes suffisants.
- Focus states visibles.
- Labels pour inputs.
- Navigation clavier.
- Tooltips courts.
- Sidebar collapsible.
- Tables scrollables.
- Panneaux adaptables.
- Dark/light lisibles.
- Réduction motion respectée.

Constraints:
- Ne pas changer l’identité visuelle.
- Ne pas rendre l’interface plus lourde.
- Mobile complet non prioritaire si application orientée trading desktop.

Done when:
- Les pages restent utilisables à plusieurs tailles.
- Les actions sont accessibles au clavier.
- Le build passe.
```

---

# GOAL 49 — Tests fonctionnels minimum

```text
Goal:
Créer les tests minimum pour vérifier que Thoon fonctionne.

Tests à couvrir:
- Layout se rend.
- Navigation vers chaque page.
- Theme toggle fonctionne.
- Watchlist ouvre une paire sur Chart.
- Add to Strategy depuis Watchlist.
- Trade Markers mettent à jour Position Builder.
- Position Builder calcule risk/reward.
- Live Order ouvre confirmation.
- Risk Engine bloque ordre sans stop-loss.
- Strategy Builder sauvegarde une stratégie.
- Create Bot bloque live si exchange non connecté.
- Backtest affiche des résultats.
- Paper Testing ajoute un trade au log.
- Preferences sauvegardent les paramètres.
- Exchange API form masque les secrets.
- Empty states s’affichent si données vides.
- Error states s’affichent si blocker.

Constraints:
- Prioriser tests utiles.
- Ne pas tester les détails purement visuels.
- Garder les tests maintenables.

Done when:
- Les tests passent.
- Les fonctionnalités critiques sont couvertes.
- Le build passe.
```

---

# GOAL 50 — Vérification finale application

```text
Goal:
Vérifier que l’application Thoon fonctionne correctement de bout en bout.

Checklist:
- Le projet démarre sans erreur.
- Le build passe.
- Les pages principales sont accessibles.
- Le menu actif fonctionne.
- Dark/light fonctionne.
- Charts affiche une paire.
- Watchlist ouvre une paire sur chart.
- Markets peut ouvrir une paire sur chart.
- Trade Markers fonctionnent.
- Position Builder calcule correctement.
- Execute Live ouvre confirmation.
- Risk Engine bloque les ordres dangereux.
- Backtest affiche résultats.
- Replay/Paper Testing fonctionne.
- Strategy Builder crée une stratégie.
- Strategy Detail affiche les infos.
- Create Bot fonctionne en mode paper.
- Launch Live Bot demande confirmation.
- Bots list et Bot Detail fonctionnent.
- Orders affiche positions et ordres.
- Alerts crée et liste des alertes.
- Trade Journal affiche trades et détails.
- Exchange & API masque les secrets.
- Risk Rules sont appliquées.
- Trade Limits sont appliquées.
- Audit Logs liste les événements.
- Empty states sont propres.
- Error states sont clairs.
- Preferences sont complètes.
- Layouts / Workspace fonctionne.
- Aucun lien principal n’est cassé.
- Aucun texte interdit ou marque externe inutile.
- Aucune clé API n’est exposée.
- L’interface reste épurée.

Done when:
- Toutes les checks critiques passent.
- Le build passe.
- Les tests passent.
- Codex fournit un résumé des changements.
- Codex liste les points restants s’il y en a.
```
