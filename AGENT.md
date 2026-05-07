# AGENT.md — Instructions pour travailler sur Thoon

## Rôle

Tu travailles sur **Thoon**, une application privée de trading crypto.

Ton objectif est de produire une application :

- épurée ;
- visuelle ;
- professionnelle ;
- compréhensible ;
- orientée action ;
- sécurisée ;
- connectée aux exchanges.

## Stack obligatoire

Pour Thoon, utilise toujours :

```text
Next.js App Router
React
TypeScript
```

Ne pas utiliser Vite ni React Router sauf demande explicite.

Règles Next.js :

- App Router sous `src/app`.
- Server Components par défaut.
- Client Components seulement pour l’interactivité, les hooks ou les APIs navigateur.
- Aucune clé API ou logique exchange sensible côté client.

## Règles de design

### Ne jamais faire

- Ne pas créer une interface remplie de texte.
- Ne pas ajouter de fioritures inutiles.
- Ne pas multiplier les menus sans raison.
- Ne pas cacher les actions importantes.
- Ne pas créer de pages qui répètent les mêmes informations.
- Ne pas surcharger le dashboard principal.

### Toujours faire

- Garder l’interface lisible.
- Mettre les actions principales à portée de main.
- Garder une hiérarchie claire.
- Prévoir dark mode et light mode.
- Connecter les pages entre elles.
- Faire en sorte que chaque outil aille au bout de son action.

## Philosophie produit

Thoon doit être :

```text
simple en façade
puissant en profondeur
visuel avant textuel
rapide à comprendre
strict sur le risque
utile à chaque clic
```

## Pages principales

Le menu principal doit contenir :

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

## Chart page

La page Charts est prioritaire.

Elle doit contenir :

- chart en chandeliers ;
- volume ;
- timeframes ;
- indicateurs ;
- outils de dessin ;
- position builder ;
- trade markers ;
- bouton paper/live ;
- bouton execute ;
- bouton save setup ;
- bouton create alert.

## Trade Markers

Créer un onglet dédié, séparé des autres outils, toujours accessible sur la page Charts.

Instruments :

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

Règle :

- Un marqueur posé sur le chart crée une donnée de trading.
- Entry crée le prix d’entrée.
- Exit crée la sortie.
- Stop Loss crée le risque.
- Take Profit crée l’objectif.
- Tous les marqueurs sont déplaçables.
- Le panneau de trading doit se mettre à jour automatiquement.

## Risk Engine

Le Risk Engine est obligatoire.

Il doit pouvoir bloquer :

- ordre sans stop-loss ;
- risque supérieur à la limite ;
- levier trop élevé ;
- perte journalière atteinte ;
- bot en drawdown excessif ;
- exchange déconnecté ;
- API invalide.

## Confirmations critiques

Toujours demander confirmation pour :

- ordre réel ;
- lancement d’un bot live ;
- fermeture de toutes les positions ;
- révocation d’une clé API ;
- suppression d’une stratégie ;
- suppression d’un bot ;
- activation emergency kill switch.

## Pages à créer en priorité

1. Strategy Detail.
2. Bot Detail.
3. Trade Limits.
4. Audit Logs.
5. Confirmation Live Order.
6. Confirmation Launch Bot Live.
7. Empty State — No Bot.
8. Empty State — No Exchange Connected.
9. Error State — Order Blocked by Risk Engine.
10. Error State — API Disconnected.

## Connexions entre pages

Prévoir ces liens :

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

## Sécurité API

Les clés API doivent :

- être chiffrées ;
- ne jamais être exposées côté frontend ;
- avoir retraits désactivés ;
- avoir permissions limitées ;
- être testées avant sauvegarde ;
- pouvoir être révoquées ;
- être journalisées dans Audit Logs.

## Objectif final

Créer une base solide pour une application qui ressemble à un terminal de trading professionnel, mais qui reste simple à comprendre pour un utilisateur lambda.
