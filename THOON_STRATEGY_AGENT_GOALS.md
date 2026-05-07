# THOON_STRATEGY_AGENT_GOALS.md — Goals pour intégrer le Strategy Agent dans Thoon

Ce fichier définit les objectifs à donner à Codex pour intégrer un **Strategy Agent** dans Thoon sans dénaturer l’application.

L’application possède déjà ou prévoit déjà :

- module Strategy Builder ;
- module Strategy Detail ;
- module Backtest ;
- module Replay / Paper Testing ;
- module Bot Builder ;
- module Risk Engine ;
- module Audit Logs ;
- module Trade Journal ;
- module Exchange & API.

Le rôle de l’agent n’est pas de remplacer ces modules.  
Son rôle est de les utiliser intelligemment.

## Mise à jour d’implémentation — 2026-05-07

Le Strategy Agent est maintenant orienté **recherche agressive pour backtesting et paper testing** :

- provider par défaut `codex` côté serveur ;
- variantes, backtests, comparaisons et paper tests autorisés sans confirmation par défaut ;
- stratégie core `Core TRIX Donchian ATR 1H` protégée en version originale ;
- les expériences passent par des versions/variantes, jamais par l’écrasement de l’original ;
- live trading, lancement bot live, clés API, Risk Rules et Trade Limits restent hors boucle automatique.

Cette prudence ne concerne pas la recherche stratégie : elle ne bloque que les actions de production réelles.

---

## 1. Vision du Strategy Agent

### Définition

Le **Thoon Strategy Agent** est un assistant intégré à l’application qui aide à analyser, tester, améliorer et suivre une stratégie de trading, sans casser la logique produit existante.

### Objectif principal

```text
Aider l’utilisateur à faire évoluer ses stratégies sans dénaturer la stratégie originale, sans surcharger l’interface, et sans lancer d’action risquée sans autorisation.
```

### Ce que l’agent peut faire

```text
Analyser une stratégie
Lire ses conditions
Lire ses résultats de backtest
Comparer plusieurs versions
Créer une variante contrôlée
Proposer une amélioration
Lancer un backtest si autorisé
Envoyer une version en paper testing si autorisé
Préparer un bot si autorisé
Surveiller une stratégie ou un bot
Créer un rapport synthétique
Détecter les anomalies
Archiver une version faible si autorisé
```

### Ce que l’agent ne doit pas faire sans autorisation

```text
Modifier la stratégie originale
Supprimer une stratégie
Lancer un bot live
Modifier les règles de risque
Changer les clés API
Augmenter le levier
Supprimer un stop-loss
Activer du trading réel
Fermer toutes les positions
Révoquer une clé API
```

---

## 2. Principe non négociable

L’agent doit s’intégrer dans Thoon sans transformer l’application en interface remplie de texte.

### Règle UI

```text
L’agent doit être discret.
L’agent doit être accessible via un panneau, un bouton ou un drawer.
L’agent ne doit pas ajouter des explications visibles partout.
L’agent doit afficher des résumés courts.
Les détails doivent être accessibles au clic.
```

### Affichage recommandé

- Bouton “Agent” dans les pages Strategy, Backtest, Bot et Journal.
- Panneau latéral discret.
- Résumé compact.
- Actions proposées sous forme de boutons.
- Explications longues cachées dans “Voir détails”.
- Historique des actions dans Audit Logs.

---

## 3. Modes de fonctionnement de l’agent

Le Strategy Agent doit avoir plusieurs niveaux d’autonomie.

### Mode 1 — Manuel

L’agent ne fait rien sans demande explicite.

```text
Il analyse seulement quand l’utilisateur clique.
Il propose seulement.
Il ne modifie rien.
Il ne lance aucun test automatiquement.
```

### Mode 2 — Assisté

L’agent peut préparer des actions, mais demande confirmation avant de les exécuter.

```text
Il peut proposer une variante.
Il peut préparer un backtest.
Il peut préparer un paper test.
Il peut préparer un bot.
Il demande confirmation avant action.
```

### Mode 3 — Autonome limité

L’agent peut exécuter certaines actions non dangereuses.

Actions autorisées :

```text
Créer une variante draft
Lancer un backtest
Comparer des résultats
Créer un rapport
Taguer une stratégie
Mettre une version en observation
Créer une note dans le journal
```

Actions interdites sans confirmation :

```text
Live trading
Lancer un bot live
Modifier Risk Rules
Modifier Trade Limits
Modifier API keys
Supprimer une stratégie
Archiver une stratégie originale
```

### Mode 4 — Autonome avec garde-fous

L’agent peut travailler plus librement, mais uniquement dans un périmètre défini.

Exemple :

```text
Optimiser uniquement Core Strategy v1.x
Tester uniquement BTC/USDT, ETH/USDT, SOL/USDT
Timeframes autorisées : 15m, 1h, 4h
Risque max : 1 %
Pas de live trading
Pas de changement de logique centrale
```

### Mode interdit

L’agent ne doit jamais avoir un mode “full automatique sans limite”.

```text
Pas d’autonomie totale.
Pas de trading réel sans confirmation.
Pas de modification des règles critiques sans validation.
```

---

## 4. Core Strategy Protection

Si l’utilisateur possède une stratégie principale déjà validée, elle doit être protégée.

### Règle

```text
La stratégie originale ne doit jamais être écrasée.
Toute modification doit créer une nouvelle version.
```

### Exemple de versioning

```text
Core Strategy v1.0 — originale protégée
Core Strategy v1.1 — ajustement léger
Core Strategy v1.2 — variation timeframe
Core Strategy v1.3 — variation marché
Core Strategy v2.0 — changement majeur
```

### Actions autorisées

```text
Dupliquer
Créer variante
Comparer
Backtester
Envoyer en paper
Promouvoir
Archiver variante
```

### Actions interdites sans confirmation

```text
Modifier v1.0
Supprimer v1.0
Archiver v1.0
Remplacer v1.0
Promouvoir une variante en live
```

---

# GOAL 01 — Créer le modèle de données du Strategy Agent

```text
Goal:
Créer les types, structures et données nécessaires pour intégrer le Strategy Agent à Thoon.

Requirements:
- Créer un type StrategyAgentMode :
  - manual
  - assisted
  - limited_autonomous
  - guarded_autonomous
- Créer un type AgentPermission.
- Créer un type AgentAction.
- Créer un type AgentSuggestion.
- Créer un type StrategyVersion.
- Créer un type AgentDecision.
- Créer un type AgentRun.
- Créer un type AgentReport.
- Créer des données mockées pour tester l’agent.
- Relier StrategyAgent aux stratégies existantes.
- Relier StrategyAgent aux backtests existants.
- Relier StrategyAgent aux bots existants.
- Relier StrategyAgent au Risk Engine.

Constraints:
- Ne pas casser les types existants.
- Ne pas remplacer le Strategy Builder.
- Ne pas remplacer le Backtest Engine.
- Ne pas remplacer le Bot Builder.
- Ne jamais stocker de clés API dans l’agent.
- Ne pas créer de logique live trading dans cette étape.

Done when:
- Les types sont créés.
- Les mocks existent.
- Les stratégies peuvent avoir des versions.
- L’agent peut être rattaché à une stratégie.
- Le build passe.
```

---

# GOAL 02 — Créer les paramètres de l’agent dans Preferences

```text
Goal:
Créer une page ou section Preferences dédiée au Strategy Agent.

Route recommandée:
- /preferences/agent

Requirements:
- Ajouter “Agent” dans la navigation Preferences.
- Afficher le mode d’autonomie :
  - Manuel
  - Assisté
  - Autonome limité
  - Autonome avec garde-fous
- Ajouter les permissions :
  - Peut analyser stratégie
  - Peut créer variante draft
  - Peut lancer backtest
  - Peut lancer paper test
  - Peut créer rapport
  - Peut préparer bot
  - Peut modifier variante
  - Peut archiver variante
- Permissions interdites par défaut :
  - lancer live bot
  - modifier stratégie originale
  - modifier risk rules
  - modifier API keys
  - supprimer stratégie
- Ajouter limites :
  - marchés autorisés
  - timeframes autorisés
  - nombre max de variantes par jour
  - nombre max de backtests par jour
  - période de test minimale
  - drawdown max acceptable
  - profit factor minimum
  - nombre minimum de trades
- Ajouter “Ask before” :
  - before creating variant
  - before running backtest
  - before paper testing
  - before preparing bot
  - before archiving version
- Ajouter “Never without confirmation” :
  - live trading
  - live bot launch
  - strategy original edit
  - risk rule changes
  - API changes
  - delete actions

Constraints:
- Interface compacte.
- Pas d’explications longues visibles.
- Utiliser icônes info pour expliquer les modes.
- Tout doit être désactivable.
- Les réglages dangereux doivent être bloqués par défaut.

Done when:
- La page Preferences Agent existe.
- Les modes d’autonomie sont configurables.
- Les permissions sont visibles.
- Les règles dangereuses sont protégées.
- Le build passe.
```

---

# GOAL 03 — Créer le panneau Agent discret

```text
Goal:
Créer un panneau Agent discret et réutilisable dans les pages concernées.

Pages concernées:
- Strategy Detail
- Create Strategy
- Backtest
- Bot Detail
- Trade Journal
- Charts

Requirements:
- Créer un bouton “Agent”.
- Ouvrir un panneau latéral ou drawer.
- Afficher :
  - statut de l’agent
  - mode actuel
  - stratégie liée
  - dernière analyse
  - suggestions
  - actions disponibles
- Actions possibles :
  - Analyser
  - Proposer variante
  - Comparer versions
  - Lancer backtest
  - Préparer paper test
  - Créer rapport
  - Voir historique agent
- Les actions doivent être filtrées selon les permissions.

Constraints:
- Ne pas mettre le panneau visible en permanence.
- Ne pas ajouter de longs textes dans les pages principales.
- L’agent doit rester secondaire par rapport aux modules métier.
- Les suggestions doivent être courtes.
- Les détails doivent être cachés dans “Voir détails”.

Done when:
- Le panneau Agent existe.
- Il peut être ouvert/fermé.
- Il affiche des suggestions mockées.
- Les permissions contrôlent les actions.
- Le build passe.
```

---

# GOAL 04 — Créer Core Strategy Lab

```text
Goal:
Créer la page Core Strategy Lab pour gérer la stratégie principale et ses variantes.

Route recommandée:
- /strategies/core-lab

Requirements:
- Afficher la stratégie principale protégée.
- Afficher les versions :
  - version
  - status
  - marché
  - timeframe
  - performance
  - drawdown
  - paper status
  - created by
  - date
- Afficher les variantes actives.
- Afficher les variantes rejetées.
- Afficher les variantes en paper.
- Afficher les variantes candidates.
- Actions :
  - créer variante
  - comparer
  - backtester
  - envoyer en paper
  - promouvoir
  - archiver
  - voir détails
- Ajouter un badge “Original Protected” sur la version principale.
- Ajouter un bouton Agent :
  - analyser core strategy
  - proposer variante
  - comparer versions
  - générer rapport

Constraints:
- La stratégie originale ne peut pas être modifiée directement.
- Toute modification crée une variante.
- Promouvoir une variante doit demander confirmation.
- L’interface doit rester visuelle et compacte.
- Pas de longs textes explicatifs visibles.

Done when:
- Core Strategy Lab existe.
- La version originale est protégée.
- Les variantes sont visibles.
- Les actions sont disponibles.
- Le build passe.
```

---

# GOAL 05 — Créer Strategy Version Manager

```text
Goal:
Créer le système de versioning des stratégies.

Requirements:
- Chaque stratégie peut avoir plusieurs versions.
- Chaque version a :
  - version number
  - parent version
  - status
  - change type
  - change summary
  - created by user/agent
  - created at
  - markets tested
  - timeframes tested
  - backtest results
  - paper results
  - risk profile
- Status possibles :
  - protected
  - draft
  - testing
  - paper
  - candidate
  - live-ready
  - archived
  - rejected
- Créer une fonction duplicateStrategyVersion.
- Créer une fonction createVariant.
- Créer une fonction compareVersions.
- Créer une fonction promoteVersion.
- Créer une fonction archiveVersion.

Constraints:
- Ne jamais écraser la version originale.
- Les changements majeurs doivent créer une version majeure.
- Les changements mineurs doivent créer une version mineure.
- Toute promotion doit être loggée.
- Toute action agent doit être traçable.

Done when:
- Les versions sont gérées proprement.
- Les variantes peuvent être créées.
- La comparaison fonctionne visuellement ou via mocks.
- Le build passe.
```

---

# GOAL 06 — Créer le moteur de suggestions Agent

```text
Goal:
Créer un moteur frontend de suggestions pour le Strategy Agent.

Requirements:
L’agent doit pouvoir générer des suggestions à partir de :
- résultats backtest
- drawdown
- profit factor
- win rate
- nombre de trades
- stabilité par période
- différence entre marchés
- différence entre timeframes
- paper trading results
- risk rules

Types de suggestions :
- réduire risque
- ajuster stop-loss
- ajuster take-profit
- tester autre timeframe
- tester autre marché
- ajouter filtre volatilité
- désactiver marché faible
- envoyer version en paper
- archiver variante faible
- créer nouvelle variante
- ne rien changer

Chaque suggestion doit contenir :
- titre court
- raison courte
- impact attendu
- niveau de confiance
- risque
- action proposée
- confirmation requise true/false

Constraints:
- Ne pas présenter les suggestions comme garanties de profit.
- Ne pas optimiser uniquement le profit.
- Toujours prendre en compte drawdown et stabilité.
- Ne pas proposer plus de 3 suggestions principales à la fois.
- Les détails doivent être masqués par défaut.

Done when:
- L’agent génère des suggestions mockées/cohérentes.
- Les suggestions apparaissent dans le panneau Agent.
- Chaque suggestion a une action possible.
- Le build passe.
```

---

# GOAL 07 — Créer les règles d’amélioration contrôlée

```text
Goal:
Créer les règles qui empêchent l’agent de dénaturer une stratégie.

Requirements:
L’agent doit respecter :
- ne modifier qu’un petit nombre de paramètres à la fois ;
- ne jamais supprimer le stop-loss ;
- ne jamais augmenter le risque sans autorisation ;
- ne jamais augmenter le levier sans autorisation ;
- ne jamais changer la logique centrale sans créer une version majeure ;
- ne jamais valider une stratégie sur un seul backtest ;
- ne jamais promouvoir sans paper trading si règle activée ;
- ne jamais archiver l’originale ;
- ne jamais remplacer l’originale.

Changements mineurs :
- ajustement TP
- ajustement SL
- ajustement timeframe
- ajustement filtre volatilité
- ajustement risk %
- ajustement session horaire

Changements majeurs :
- changement indicateur principal
- changement condition d’entrée centrale
- changement logique de sortie centrale
- ajout d’un nouveau régime de marché
- changement complet du money management

Constraints:
- L’agent doit classer chaque modification en minor/major.
- Les changements majeurs doivent demander validation.
- Les changements majeurs doivent créer v2.0 ou plus.
- Les changements mineurs créent v1.1, v1.2, etc.

Done when:
- Les règles d’amélioration existent.
- Les suggestions sont classées minor/major.
- Les actions interdites sont bloquées.
- Le build passe.
```

---

# GOAL 08 — Connecter Agent au Backtest

```text
Goal:
Permettre à l’agent d’utiliser le module Backtest existant.

Requirements:
- L’agent peut préparer un backtest pour une version de stratégie.
- L’agent peut lancer un backtest seulement si autorisé.
- L’agent peut choisir :
  - stratégie/version
  - marché
  - timeframe
  - période
  - capital initial
  - frais
  - slippage
- L’agent lit les résultats :
  - net profit
  - win rate
  - profit factor
  - max drawdown
  - nombre de trades
  - période testée
- L’agent crée un résumé compact.
- L’agent compare avec la version précédente.
- L’action est loggée dans Audit Logs.

Constraints:
- Si mode manuel, l’agent ne lance pas le backtest seul.
- Si mode assisté, l’agent demande confirmation.
- Si mode autonome limité, il peut lancer uniquement dans le périmètre autorisé.
- Ne pas créer un deuxième moteur backtest séparé.

Done when:
- Depuis Agent, on peut préparer un backtest.
- Les résultats sont associés à la version.
- Les logs sont créés.
- Le build passe.
```

---

# GOAL 09 — Connecter Agent au Paper Testing

```text
Goal:
Permettre à l’agent d’envoyer une version de stratégie en paper testing.

Requirements:
- L’agent peut recommander paper testing.
- L’agent peut préparer un paper test.
- L’agent peut lancer paper test si autorisé.
- Paramètres :
  - version stratégie
  - marché
  - timeframe
  - capital fictif
  - durée de test
  - risk %
  - stop-loss required
- L’agent suit :
  - trades paper
  - PnL paper
  - drawdown paper
  - win rate paper
  - respect des règles
- L’agent produit un rapport de validation.
- L’agent propose candidate/live-ready uniquement si conditions remplies.

Constraints:
- Paper testing n’est jamais live.
- L’agent ne peut pas sauter paper testing si règle obligatoire.
- Les résultats paper doivent être distingués du backtest.

Done when:
- L’agent peut préparer un paper test.
- Les résultats paper sont rattachés à la version.
- Le build passe.
```

---

# GOAL 10 — Connecter Agent au Bot Builder

```text
Goal:
Permettre à l’agent de préparer un bot à partir d’une stratégie validée sans le lancer en live automatiquement.

Requirements:
- L’agent peut proposer “Create Bot from Version”.
- L’agent pré-remplit :
  - stratégie/version
  - exchange
  - pair
  - mode paper par défaut
  - allocated capital
  - risk per trade
  - max daily loss
  - max leverage
  - stop-loss required
- L’agent peut créer un draft bot si autorisé.
- L’agent peut préparer un live bot, mais jamais le lancer sans confirmation.
- L’agent doit afficher les blockers du Risk Engine.
- Toute action est loggée.

Constraints:
- Mode par défaut = Paper.
- Live requires explicit user confirmation.
- L’agent ne peut pas modifier API keys.
- L’agent ne peut pas augmenter le risque au-dessus des règles.

Done when:
- L’agent peut créer un draft bot.
- Le Bot Builder reçoit les données.
- Live launch reste protégé.
- Le build passe.
```

---

# GOAL 11 — Connecter Agent au Risk Engine

```text
Goal:
Connecter l’agent au Risk Engine pour contrôler toutes ses actions sensibles.

Requirements:
Risk Engine doit vérifier pour l’agent :
- permission action
- mode autonomie
- stop-loss required
- max risk
- max leverage
- drawdown max
- paper test required
- exchange connected
- API permissions
- trade limits
- user confirmation required

L’agent doit recevoir :
- allowed true/false
- blockers
- warnings
- required confirmation
- suggested safe action

Constraints:
- L’agent ne contourne jamais le Risk Engine.
- Toute action live doit être bloquée sans validation.
- Risk Engine a priorité sur l’agent.
- Si conflit, Risk Engine gagne.

Done when:
- Les actions agent passent par Risk Engine.
- Les blockers sont affichés.
- Les actions interdites sont bloquées.
- Le build passe.
```

---

# GOAL 12 — Créer Agent Activity Log

```text
Goal:
Créer un historique visible des actions de l’agent.

Requirements:
Chaque action agent doit être loggée :
- date/time
- action
- strategy/version
- mode agent
- permission used
- result
- user confirmation yes/no
- risk engine result
- notes

Actions à logger :
- analyse stratégie
- création variante
- lancement backtest
- lecture backtest
- proposition amélioration
- lancement paper
- création draft bot
- promotion version
- archivage variante
- action bloquée par Risk Engine

Constraints:
- Ne pas afficher de secrets.
- Logs courts et filtrables.
- Audit Logs doit recevoir les événements importants.

Done when:
- Agent Activity Log existe.
- Les actions agent sont visibles.
- Les événements importants apparaissent dans Audit Logs.
- Le build passe.
```

---

# GOAL 13 — Créer Agent Report

```text
Goal:
Créer les rapports synthétiques produits par l’agent.

Requirements:
Le rapport doit inclure :
- stratégie analysée
- version
- marchés testés
- timeframes testés
- période testée
- points forts
- points faibles
- backtest summary
- paper summary
- risques détectés
- recommandations
- prochaine action proposée
- statut :
  - no action
  - needs test
  - paper candidate
  - bot candidate
  - reject
  - archive
  - monitor

UI:
- résumé compact visible
- détails repliés
- bouton Export
- bouton Save to Journal
- bouton Create Task/Action si utile

Constraints:
- Ne pas présenter le rapport comme conseil financier.
- Ne pas afficher trop de texte par défaut.
- Résumé clair en 5 lignes maximum.
- Détails uniquement au clic.

Done when:
- L’agent peut créer un rapport.
- Le rapport peut être sauvegardé.
- Le build passe.
```

---

# GOAL 14 — Créer les confirmations spécifiques Agent

```text
Goal:
Créer les modales de confirmation pour les actions sensibles de l’agent.

Confirmations nécessaires:
- Confirm Create Variant
- Confirm Run Backtest
- Confirm Send to Paper
- Confirm Prepare Bot
- Confirm Promote Version
- Confirm Archive Variant
- Confirm Major Strategy Change
- Confirm Live Bot Launch
- Confirm Risk Rule Conflict

Chaque modale doit afficher:
- action demandée
- stratégie/version concernée
- impact
- risques
- confirmation requise
- cancel
- confirm

Constraints:
- Pas de confirmation pour actions totalement passives.
- Confirmation obligatoire pour actions sensibles.
- Live trading reste toujours séparé et fortement protégé.

Done when:
- Les confirmations existent.
- Les actions sensibles passent par elles.
- Le build passe.
```

---

# GOAL 15 — Créer les permissions Agent

```text
Goal:
Créer un système de permissions simple pour contrôler ce que l’agent peut faire.

Permissions:
- analyze_strategy
- create_variant
- edit_variant
- run_backtest
- run_paper_test
- create_report
- prepare_bot
- create_draft_bot
- archive_variant
- promote_version
- suggest_risk_change
- read_journal
- write_journal_note
- read_audit_logs

Permissions interdites par défaut:
- edit_original_strategy
- delete_strategy
- launch_live_bot
- execute_live_trade
- modify_api_keys
- modify_risk_rules
- modify_trade_limits
- revoke_api_key
- close_positions

Constraints:
- Permissions doivent dépendre du mode agent.
- Les permissions doivent être visibles dans Preferences Agent.
- Les actions non autorisées doivent être grisées ou cachées.
- Risk Engine doit valider en plus des permissions.

Done when:
- Les permissions existent.
- Les actions agent respectent les permissions.
- Le build passe.
```

---

# GOAL 16 — Créer le système Ask / Auto

```text
Goal:
Créer un système qui décide si l’agent agit automatiquement ou demande à l’utilisateur.

Requirements:
Chaque action agent doit avoir un niveau:
- auto_allowed
- ask_first
- always_confirm
- forbidden

Mapping recommandé:
- analyze_strategy → auto_allowed
- create_report → auto_allowed
- create_variant → ask_first ou auto selon mode
- run_backtest → ask_first ou auto selon mode
- run_paper_test → ask_first
- prepare_bot → ask_first
- promote_version → always_confirm
- archive_variant → always_confirm
- live bot launch → always_confirm
- modify original → forbidden sauf override manuel explicite

UI:
- Afficher “Agent will ask” ou “Agent can run automatically”.
- Ajouter toggle par action dans Preferences Agent.

Constraints:
- Live actions ne doivent jamais être auto_allowed.
- Les actions destructives ne doivent jamais être auto_allowed.
- Le mode manuel force tout à ask_first.

Done when:
- Chaque action agent a une politique Ask/Auto.
- Le panneau Agent respecte cette politique.
- Le build passe.
```

---

# GOAL 17 — Créer Strategy Optimizer Queue

```text
Goal:
Créer une file d’attente d’optimisation pour que l’agent puisse travailler proprement.

Requirements:
- Liste des tâches agent :
  - analyze
  - create variant
  - run backtest
  - compare
  - report
  - send to paper
- Status :
  - queued
  - running
  - waiting for confirmation
  - completed
  - blocked
  - failed
- Priority :
  - low
  - normal
  - high
- Afficher :
  - task
  - strategy/version
  - status
  - next action
  - result
- Actions :
  - pause queue
  - resume queue
  - cancel task
  - approve task
  - view details

Constraints:
- Ne pas faire du vrai travail asynchrone non contrôlé si l’environnement ne le permet pas.
- La queue peut être simulée côté frontend au départ.
- Les tâches bloquées doivent expliquer pourquoi.

Done when:
- L’agent peut afficher une queue d’actions.
- Les tâches demandant validation sont visibles.
- Le build passe.
```

---

# GOAL 18 — Créer Market Regime Detection pour l’agent

```text
Goal:
Créer une première détection simple du régime de marché pour guider l’agent.

Requirements:
Régimes possibles:
- trend_up
- trend_down
- range
- high_volatility
- low_volatility
- breakout
- uncertain

Données utilisées:
- EMA slope
- ATR / volatility
- range width
- volume
- higher highs / lower lows
- price location

L’agent doit utiliser le régime pour:
- recommander une version adaptée
- éviter de tester une stratégie sur un contexte non adapté
- taguer les backtests
- comparer performance par régime

Constraints:
- Ne pas présenter la détection comme parfaite.
- Elle doit être un filtre d’aide.
- Ne pas surcharger l’UI.

Done when:
- Un régime est calculé ou mocké.
- Les stratégies peuvent être taguées par régime.
- L’agent utilise cette info dans ses rapports.
- Le build passe.
```

---

# GOAL 19 — Créer Robustness Score

```text
Goal:
Créer un score de robustesse pour évaluer les versions de stratégie.

Requirements:
Score basé sur:
- profit factor
- max drawdown
- nombre de trades
- stabilité sur plusieurs périodes
- stabilité sur plusieurs marchés
- stabilité sur plusieurs timeframes
- performance paper
- respect des risk rules
- écart backtest vs paper
- overfitting warning

Afficher:
- Robustness Score de 0 à 100
- Badge :
  - weak
  - unstable
  - acceptable
  - strong
  - candidate
- Raisons principales du score.
- Bouton “Voir détails”.

Constraints:
- Ne pas baser le score uniquement sur le profit.
- Pénaliser les tests avec trop peu de trades.
- Pénaliser les gros drawdowns.
- Pénaliser les résultats incohérents entre marchés.

Done when:
- Les versions ont un score de robustesse.
- L’agent peut trier les variantes par score.
- Le build passe.
```

---

# GOAL 20 — Créer Overfitting Guard

```text
Goal:
Créer un garde-fou contre l’overfitting.

Requirements:
Détecter les signaux d’overfitting:
- trop peu de trades
- profit trop élevé sur une courte période
- drawdown très faible mais peu de trades
- performance excellente sur un seul marché
- performance mauvaise hors période testée
- trop de paramètres modifiés
- stratégie trop complexe
- écart important backtest vs paper

L’agent doit:
- afficher warning
- empêcher promotion automatique
- demander test out-of-sample
- recommander paper testing
- réduire score robustesse

Constraints:
- Ne pas bloquer toutes les stratégies.
- Être prudent mais pas inutilement pessimiste.
- Warnings courts.

Done when:
- Overfitting Guard existe.
- Les rapports agent affichent les warnings.
- Le build passe.
```

---

# GOAL 21 — Connecter Agent au Trade Journal

```text
Goal:
Permettre à l’agent d’écrire des notes utiles dans le Trade Journal.

Requirements:
L’agent peut ajouter:
- note de stratégie
- note de version
- note après backtest
- note après paper test
- note après bot session
- warning risk
- leçon détectée

Exemple:
- “Core Strategy v1.2 fonctionne mieux en 1h sur BTC que 15m sur SOL.”
- “Drawdown trop élevé sur période haute volatilité.”
- “Paper result divergent from backtest, monitor before bot.”

Constraints:
- L’agent ne doit pas remplir le journal de spam.
- Les notes doivent être courtes.
- L’utilisateur doit pouvoir supprimer ou masquer les notes agent.
- Les notes doivent être taguées “Agent”.

Done when:
- L’agent peut créer une note journal.
- Les notes sont identifiables.
- Le build passe.
```

---

# GOAL 22 — Créer Agent Dashboard compact

```text
Goal:
Créer un dashboard compact pour suivre l’activité du Strategy Agent.

Route recommandée:
- /agent
ou section dans /strategies/core-lab

Requirements:
- Agent status.
- Current mode.
- Active tasks.
- Latest suggestions.
- Strategies monitored.
- Versions created.
- Backtests run.
- Paper validations.
- Blocked actions.
- Recent agent logs.
- Quick actions :
  - Analyze Core Strategy
  - Compare Versions
  - Run Allowed Tests
  - View Reports
  - Open Preferences

Constraints:
- Dashboard compact.
- Pas de longues explications visibles.
- L’agent ne doit pas devenir plus important que le trading lui-même.

Done when:
- L’activité agent est visible.
- L’utilisateur peut contrôler l’agent.
- Le build passe.
```

---

# GOAL 23 — Créer Prompt / Instruction Store pour l’agent

```text
Goal:
Créer un espace où l’utilisateur peut définir les instructions permanentes de l’agent.

Requirements:
- Instructions générales.
- Stratégie principale à respecter.
- Paramètres que l’agent peut modifier.
- Paramètres interdits.
- Marchés autorisés.
- Timeframes autorisés.
- Règles de validation.
- Règles de paper testing.
- Règles de promotion.
- Règles d’archivage.
- Style de rapport.

Constraints:
- Ne pas faire une interface trop texte dans l’app principale.
- Cette page peut être plus textuelle car elle sert à configurer l’agent.
- Ajouter exemples courts.
- Les instructions doivent être sauvegardables.
- Les instructions ne doivent pas remplacer Risk Engine.

Done when:
- L’utilisateur peut écrire les règles de l’agent.
- Les règles sont utilisées par les suggestions.
- Le build passe.
```

---

# GOAL 24 — Créer Agent Safe Defaults

```text
Goal:
Définir les paramètres par défaut sûrs du Strategy Agent.

Default mode:
- assisted

Default permissions:
- can analyze strategy
- can create report
- can suggest variant
- can prepare backtest
- cannot run live
- cannot modify original
- cannot modify risk rules
- cannot modify API keys
- cannot delete

Default Ask/Auto:
- analysis = auto
- report = auto
- create variant = ask
- run backtest = ask
- paper test = ask
- prepare bot = ask
- promote version = confirm
- archive version = confirm
- live action = confirm + Risk Engine

Default constraints:
- max variants per day = 3
- max backtests per day = 10
- min trades required = 30
- max drawdown candidate = user-defined
- paper required before live = true

Done when:
- Safe defaults sont appliqués.
- L’utilisateur peut les modifier.
- Le build passe.
```

---

# GOAL 25 — Créer l’intégration Agent dans Strategy Detail

```text
Goal:
Ajouter l’agent dans Strategy Detail sans dénaturer la page.

Requirements:
- Bouton Agent dans le header.
- Résumé agent compact :
  - status
  - last analysis
  - latest suggestion
  - robustness score
- Actions :
  - Analyze strategy
  - Create variant
  - Compare versions
  - Run backtest
  - Generate report
- Afficher les suggestions dans le drawer Agent.
- Afficher les versions dans un onglet Versions.
- Afficher les rapports dans un onglet Reports ou panneau.

Constraints:
- Ne pas afficher toute l’analyse directement sur la page.
- Ne pas créer un bloc de texte géant.
- Les suggestions doivent rester courtes.
- Détails au clic.

Done when:
- Strategy Detail intègre l’agent proprement.
- L’agent peut analyser la stratégie.
- Le build passe.
```

---

# GOAL 26 — Créer l’intégration Agent dans Backtest

```text
Goal:
Ajouter l’agent dans la page Backtest.

Requirements:
- Bouton Agent sur la page Backtest.
- L’agent peut :
  - interpréter un résultat
  - comparer avec une version précédente
  - détecter overfitting
  - proposer paper test
  - proposer variante
  - générer rapport
- Affichage compact :
  - score robustesse
  - warning principal
  - prochaine action recommandée

Constraints:
- Ne pas écrire une analyse longue par défaut.
- Les détails doivent être repliés.
- L’agent ne doit pas modifier les résultats.

Done when:
- L’agent peut lire un résultat backtest.
- Il peut proposer une action.
- Le build passe.
```

---

# GOAL 27 — Créer l’intégration Agent dans Bot Detail

```text
Goal:
Ajouter l’agent dans la page Bot Detail.

Requirements:
- Bouton Agent dans Bot Detail.
- L’agent peut :
  - analyser performance bot
  - détecter anomalies
  - recommander pause
  - recommander réduire risque
  - recommander retour paper
  - générer rapport
- L’agent ne peut pas :
  - arrêter bot live sans confirmation
  - modifier paramètres live sans confirmation
  - augmenter risque
- Afficher :
  - last bot health check
  - warning
  - suggested action

Constraints:
- Pas de décision live automatique.
- Les recommandations doivent être courtes.
- Toute action sensible passe par Risk Engine.

Done when:
- Bot Detail intègre l’agent.
- Les recommandations bot sont visibles.
- Le build passe.
```

---

# GOAL 28 — Créer l’intégration Agent dans Charts

```text
Goal:
Ajouter l’agent dans Charts sans surcharger le graphique.

Requirements:
- Bouton Agent discret.
- L’agent peut :
  - lire la paire active
  - lire les trade markers
  - lire le position builder
  - lire la stratégie sélectionnée
  - proposer save setup
  - proposer convertir setup en stratégie
  - signaler incohérence risk/reward
- Affichage :
  - mini suggestion
  - bouton details
  - bouton create variant si setup intéressant

Constraints:
- Ne pas ajouter de texte sur le chart.
- Ne pas masquer les candles.
- Ne pas agir sur les ordres live sans confirmation.
- L’agent ne doit pas remplacer le Position Builder.

Done when:
- Charts a un accès Agent discret.
- L’agent peut analyser un setup visuel.
- Le build passe.
```

---

# GOAL 29 — Créer Validation Pipeline

```text
Goal:
Créer un pipeline clair pour valider une version de stratégie.

Stages:
1. Draft.
2. Backtested.
3. Out-of-sample tested.
4. Paper tested.
5. Candidate.
6. Bot draft.
7. Live-ready.
8. Live active.
9. Archived / Rejected.

Requirements:
- Chaque version a un stage.
- L’agent peut proposer le passage au stage suivant.
- Certains passages nécessitent confirmation.
- Certains passages nécessitent seuils :
  - min trades
  - max drawdown
  - profit factor min
  - paper duration
  - no critical risk warnings
- Afficher stage dans Core Strategy Lab et Strategy Detail.

Constraints:
- Ne pas permettre Live-ready sans validation minimum.
- Paper required si réglage activé.
- L’utilisateur garde le dernier mot pour le live.

Done when:
- Les stages existent.
- L’agent respecte le pipeline.
- Le build passe.
```

---

# GOAL 30 — Vérifier l’intégration complète de l’agent

```text
Goal:
Vérifier que le Strategy Agent est intégré à Thoon sans dénaturer l’application.

Checklist:
- L’agent existe dans Preferences.
- Les modes autonomie existent.
- Les permissions agent existent.
- Le système Ask/Auto fonctionne.
- Le panneau Agent est discret.
- Core Strategy Lab existe.
- La stratégie originale est protégée.
- Les versions de stratégie sont gérées.
- L’agent peut analyser une stratégie.
- L’agent peut créer une variante si autorisé.
- L’agent peut préparer/lancer un backtest selon permissions.
- L’agent peut proposer paper testing.
- L’agent peut préparer un bot draft.
- L’agent ne peut pas lancer live sans confirmation.
- L’agent ne peut pas modifier API keys.
- L’agent ne peut pas modifier Risk Rules sans validation.
- L’agent ne peut pas supprimer la stratégie originale.
- Risk Engine contrôle les actions sensibles.
- Audit Logs reçoivent les actions importantes.
- Agent Activity Log fonctionne.
- Les rapports agent sont courts par défaut.
- Les détails sont cachés au clic.
- L’interface reste épurée.
- Le build passe.
- Les tests passent.

Done when:
- Tous les points critiques sont validés.
- Codex fournit un résumé des changements.
- Codex liste les limites restantes.
- L’application reste cohérente avec README.md, PLAN.md, AGENT.md et thoon_roadmap_succes.md.
```

---

## Résumé final pour Codex

```text
Le Strategy Agent doit être intégré comme une couche d’intelligence contrôlée.

Il doit utiliser les modules existants :
- Strategy Builder
- Backtest
- Paper Testing
- Bot Builder
- Risk Engine
- Journal
- Audit Logs

Il ne doit pas remplacer ces modules.

Il doit pouvoir être :
- manuel
- assisté
- autonome limité
- autonome avec garde-fous

Il doit toujours respecter :
- la stratégie originale protégée
- les permissions utilisateur
- les confirmations
- le Risk Engine
- une interface épurée
- aucune action live sans validation
```
