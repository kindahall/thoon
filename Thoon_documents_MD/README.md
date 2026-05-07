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
