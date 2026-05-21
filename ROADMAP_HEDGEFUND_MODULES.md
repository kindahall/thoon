# Roadmap Hedge Fund Modules

Objectif: faire evoluer l'application vers une infrastructure quant plus proche d'un hedge fund professionnel, par etapes suivies une par une.

Statuts:
- TODO = pas encore commence
- IN_PROGRESS = en cours
- DONE = termine et teste
- BLOCKED = bloque par une dependance ou une decision

## Etat Actuel De La Plateforme

- DONE - Market data crypto reel Binance / Bybit
- DONE - WebSocket live Binance
- DONE - Backtesting vectorbt sur donnees historiques reelles
- DONE - Paper trading avec prix reels
- DONE - Execution engine avec paper mode par defaut
- DONE - Kill switch et risk limits de base
- DONE - LLM Gateway centralise
- DONE - Macro agent via donnees reelles
- DONE - Macro quant cross-asset BTC / ETH / FRED
- DONE - Research lab autonome
- DONE - Research platform avec PostgreSQL
- DONE - Portfolio allocation dynamique
- DONE - Arbitrage Binance / Bybit avec order books reels
- DONE - Monitoring Docker / Prometheus / Grafana

## Niveau Hedge Fund - Etat Reel

Statut: NOT_READY

Important: les modules ci-dessus rapprochent Bud d'une architecture quant professionnelle, mais ils ne prouvent pas encore que la plateforme est exploitable au niveau hedge fund.

Constat minimal au 2026-05-21:
- Les briques backend critiques existent et sont testables.
- La recherche strategie existe, mais la selection robuste n'est pas encore prouvee sur un track record long.
- Les resultats paper long terme ne sont pas encore suffisants pour promouvoir une strategie en live.
- Le live trading reel doit rester bloque tant que les gates ci-dessous ne sont pas valides.

Definition stricte:
- "Module DONE" = le composant technique existe, tourne sur donnees reelles et a un endpoint testable.
- "Hedge fund ready" = le systeme a prouve robustesse, gouvernance, observabilite, execution quality, securite, audit, disaster recovery et performance paper sur duree.

Interdictions avant validation finale:
- Ne pas annoncer une strategie comme live-ready sans paper trading long terme.
- Ne pas promouvoir une strategie sur un seul backtest.
- Ne pas utiliser une performance in-sample comme preuve.
- Ne pas lancer d'ordre live sans readiness, risk engine, kill switch, audit et validation humaine.
- Ne pas masquer les strategies rejetees ou les periodes perdantes.

## Etape 1 - Data Quality Engine

Statut: DONE

But: verifier que les donnees sont propres avant backtest, recherche, agents ou allocation.

A construire:
- DONE - detection candles manquantes
- DONE - detection timestamps incoherents
- DONE - detection volumes nuls ou anormaux
- DONE - detection prix aberrants
- DONE - comparaison Binance vs Bybit
- DONE - score qualite par dataset
- DONE - blocage backtest si donnees non fiables
- DONE - blocage research lab si donnees non fiables
- DONE - blocage research platform si donnees non fiables
- DONE - blocage macro quant si donnees crypto non fiables

Endpoints:
- DONE - POST /data-quality/check
- DONE - GET /data-quality/check

Output attendu:

```json
{
  "quality_score": 0.0,
  "issues": [],
  "usable_for_backtest": true
}
```

## Etape 2 - Transaction Cost + Slippage Engine

Statut: DONE

But: rendre les backtests et les signaux plus realistes.

A construire:
- DONE - fees par exchange avec source explicite account_api / request_override / configured_default
- DONE - refus si frais compte exacts requis mais API credentials indisponibles
- DONE - spread bid / ask depuis carnet reel
- DONE - slippage estime depuis order book reel
- DONE - market impact estime
- DONE - cout total par trade
- DONE - edge net apres couts
- DONE - rejet backtest si edge net inferieur aux couts

Endpoints:
- DONE - POST /transaction-cost/estimate
- DONE - GET /transaction-cost/estimate

Output attendu:

```json
{
  "estimated_cost_bps": 0.0,
  "slippage_bps": 0.0,
  "net_edge_after_costs": 0.0
}
```

## Etape 3 - Walk-Forward Validation Engine

Statut: DONE

But: reduire l'overfitting et verifier la robustesse temporelle.

A construire:
- train / test rolling windows
- validation temporelle stricte
- score stabilite par fold
- comparaison in-sample / out-of-sample
- detection sur-optimisation
- rejet strategies instables

Output attendu:

```json
{
  "walk_forward_score": 0.0,
  "fold_results": [],
  "overfit_risk": 0.0
}
```

## Etape 4 - Feature Store

Statut: DONE

But: centraliser les indicateurs calcules pour que tous les agents utilisent les memes features.

A construire:
- momentum
- volatilite
- volume
- correlations
- macro factors
- funding rates si disponibles
- open interest si disponible
- stockage PostgreSQL
- versioning feature set

Output attendu:

```json
{
  "features": {},
  "feature_set_id": "..."
}
```

## Etape 5 - Microstructure Engine

Statut: DONE

But: analyser le marche live plus finement avant execution ou arbitrage.

A construire:
- order book depth
- bid / ask spread
- order book imbalance
- liquidity score
- execution pressure
- short-term volatility
- detection carnets anormaux

Output attendu:

```json
{
  "spread_bps": 0.0,
  "order_book_imbalance": 0.0,
  "liquidity_score": 0.0
}
```

## Etape 6 - Advanced Risk Engine

Statut: DONE

But: rapprocher le risk management d'un systeme institutionnel.

A construire:
- VaR
- CVaR
- stress tests
- scenario analysis
- correlation shock
- liquidity risk
- concentration risk
- risk level final

Output attendu:

```json
{
  "var": 0.0,
  "cvar": 0.0,
  "stress_loss": 0.0,
  "risk_level": "low | medium | high"
}
```

## Etape 7 - Portfolio Construction Avancee

Statut: DONE

But: ameliorer l'allocation et le controle du risque portefeuille.

A construire:
- volatility targeting
- risk budgeting
- hierarchical risk parity
- drawdown-aware allocation
- allocation combinee regime macro + risque
- cash management

Output attendu:

```json
{
  "weights": {},
  "target_volatility": 0.0,
  "risk_budget": {}
}
```

## Etape 8 - Strategy Attribution

Statut: DONE

But: comprendre pourquoi une strategie gagne ou perd.

A construire:
- DONE - performance par regime
- DONE - performance par heure / jour
- DONE - performance par volatilite
- DONE - performance par exchange
- DONE - contribution des signaux
- DONE - forces
- DONE - faiblesses

Endpoints:
- DONE - POST /strategy-attribution/analyze
- DONE - GET /strategy-attribution/analyze

Output attendu:

```json
{
  "attribution": {},
  "strengths": [],
  "weaknesses": []
}
```

## Etape 9 - Experiment Tracker

Statut: DONE

But: garder une trace reproductible de toutes les recherches.

A construire:
- DONE - experiment_id
- DONE - version strategie
- DONE - dataset utilise
- DONE - periode testee
- DONE - parametres
- DONE - resultats
- DONE - decision finale
- DONE - hash configuration
- DONE - statut accepted / rejected

Endpoints:
- DONE - POST /experiments/track
- DONE - GET /experiments
- DONE - GET /experiments/{experiment_id}

Output attendu:

```json
{
  "experiment_id": "...",
  "status": "accepted | rejected",
  "reproducible": true
}
```

## Etape 10 - Live Trading Readiness

Statut: DONE

But: preparer le passage live sans danger.

A construire:
- DONE - reconciliation positions exchange vs systeme
- DONE - audit trail complet
- DONE - idempotency keys
- DONE - partial fills
- DONE - workflow promotion paper vers live
- DONE - permissions API separees
- DONE - emergency shutdown
- DONE - live readiness score

Endpoints:
- DONE - POST /live-readiness/check
- DONE - GET /live-readiness/check
- DONE - POST /live-readiness/emergency-shutdown

Output attendu:

```json
{
  "live_ready": false,
  "blockers": [],
  "safety_score": 0.0
}
```

## Etape 11 - Performance Evidence Long Terme

Statut: TODO

But: prouver que les strategies tiennent dans le temps avant toute promotion.

A construire:
- paper trading continu multi-semaines
- paper trading multi-symboles
- benchmarks BTC buy-and-hold, ETH buy-and-hold et cash
- comparaison par regime de marche
- separation train / validation / test stricte
- suivi out-of-sample uniquement
- detection degradation performance
- rapport hebdomadaire et mensuel
- score ecart backtest vs paper
- blocage promotion si paper insuffisant

Endpoints / jobs:
- TODO - POST /paper-validation/start
- TODO - GET /paper-validation/runs
- TODO - GET /paper-validation/{run_id}
- TODO - POST /paper-validation/{run_id}/report

Output attendu:

```json
{
  "paper_validation_status": "running | passed | failed | blocked",
  "duration_days": 0,
  "symbols": [],
  "benchmark_comparison": {},
  "backtest_vs_paper_gap": 0.0,
  "promotion_allowed": false
}
```

## Etape 12 - Strategy Governance

Statut: TODO

But: eviter que le systeme change, approuve ou deploie une strategie sans controle.

A construire:
- statuts strategie: draft, candidate, backtested, paper_active, paper_validated, approved, retired
- workflow approval / rejection
- versioning immuable
- changelog strategie
- justification agent obligatoire
- rollback strategie
- quarantaine strategie instable
- protection strategie originale
- validation humaine optionnelle ou obligatoire selon mode

Endpoints:
- TODO - GET /strategy-governance/strategies
- TODO - POST /strategy-governance/approve
- TODO - POST /strategy-governance/reject
- TODO - POST /strategy-governance/retire
- TODO - GET /strategy-governance/audit

Output attendu:

```json
{
  "strategy_id": "...",
  "status": "candidate | paper_validated | approved | retired",
  "version": 1,
  "approval_blockers": [],
  "human_approval_required": true
}
```

## Etape 13 - Research Factory Massive

Statut: TODO

But: industrialiser la recherche strategie au lieu de tester quelques idees isolees.

A construire:
- generation controlee de strategies candidates
- backtests massifs sur historiques reels
- walk-forward automatique
- overfitting score obligatoire
- selection robuste multi-regime
- memory des echecs
- comparaison contre baselines
- promotion automatique vers paper uniquement si criteres atteints
- quotas de recherche par symbole/timeframe
- deduplication des strategies equivalentes

Endpoints / jobs:
- TODO - POST /research-factory/run
- TODO - GET /research-factory/runs
- TODO - GET /research-factory/candidates
- TODO - GET /research-factory/leaderboard

Output attendu:

```json
{
  "candidates_generated": 0,
  "candidates_backtested": 0,
  "candidates_rejected": 0,
  "paper_candidates": 0,
  "selection_policy": {}
}
```

## Etape 14 - Portfolio Risk Professionnel

Statut: TODO

But: passer du risque par trade au risque global de portefeuille.

A construire:
- exposure globale
- exposure par actif
- exposure par exchange
- exposure par strategie
- contribution au risque par position
- correlation risk live
- concentration limits
- volatility targeting portefeuille
- drawdown budget
- risk budget par strategie
- capital allocation rules

Endpoints:
- TODO - GET /portfolio-risk/status
- TODO - POST /portfolio-risk/evaluate
- TODO - GET /portfolio-risk/contributions

Output attendu:

```json
{
  "portfolio_risk_level": "low | medium | high | blocked",
  "total_exposure": 0.0,
  "drawdown_budget_used": 0.0,
  "risk_contributions": {},
  "violations": []
}
```

## Etape 15 - Execution Quality Professionnelle

Statut: TODO

But: mesurer si l'execution detruit l'alpha.

A construire:
- slippage realise vs estime
- fill quality
- spread capture
- latency exchange
- order book depth avant execution
- post-trade analysis
- venue comparison Binance / Bybit / DEX
- rejection analysis
- market impact realise
- execution quality score par strategie

Endpoints:
- TODO - POST /execution-quality/analyze
- TODO - GET /execution-quality/orders
- TODO - GET /execution-quality/venues

Output attendu:

```json
{
  "execution_quality_score": 0.0,
  "realized_slippage_bps": 0.0,
  "estimated_slippage_bps": 0.0,
  "venue_comparison": {},
  "alpha_after_execution": 0.0
}
```

## Etape 16 - Data Quality Institutionnelle

Statut: TODO

But: garantir que chaque decision peut prouver la qualite et la provenance de ses donnees.

A construire:
- data lineage par decision
- stale data detection
- cross-exchange sanity checks
- symbol delisting detection
- exchange maintenance detection
- replay historique reproductible
- dataset snapshots
- data vendor fallback explicite
- blocage decision si lineage incomplet

Endpoints:
- TODO - GET /data-lineage/{decision_id}
- TODO - POST /data-lineage/replay
- TODO - GET /data-quality/institutional-status

Output attendu:

```json
{
  "decision_id": "...",
  "data_lineage_complete": true,
  "sources": [],
  "stale_data_detected": false,
  "replay_available": true
}
```

## Etape 17 - Model Risk Management

Statut: TODO

But: encadrer le risque lie aux agents IA, prompts et modeles quant.

A construire:
- registre modeles
- version gateway/model par decision
- prompt/version audit
- schema violation tracking
- hallucination checks
- drift detection des outputs agents
- confidence calibration
- cout LLM par strategie
- fallback si gateway indisponible
- interdiction decision live si model risk eleve

Endpoints:
- TODO - GET /model-risk/models
- TODO - GET /model-risk/decisions/{decision_id}
- TODO - POST /model-risk/evaluate

Output attendu:

```json
{
  "model_risk_score": 0.0,
  "schema_violations": [],
  "drift_detected": false,
  "live_decision_allowed": false
}
```

## Etape 18 - Operations 24/7

Statut: TODO

But: exploiter Bud sans surveillance permanente.

A construire:
- monitoring 24/7
- alerting Telegram / Email / Slack
- health checks profonds
- auto-restart controle
- degradation mode
- maintenance mode
- daily operator report
- weekly risk report
- incident runbook executable
- escalation matrix

Endpoints / jobs:
- TODO - GET /ops/status
- TODO - POST /ops/maintenance-mode
- TODO - GET /ops/daily-report
- TODO - GET /ops/weekly-risk-report

Output attendu:

```json
{
  "ops_status": "healthy | degraded | incident",
  "alerts_active": [],
  "maintenance_mode": false,
  "operator_action_required": false
}
```

## Etape 19 - Security Et Secrets Institutionnels

Statut: TODO

But: proteger cles, comptes, wallets et operations.

A construire:
- secret manager
- rotation cles API
- separation read keys / trade keys
- permissions minimales exchange
- whitelist IP si disponible
- no secret in frontend
- no secret in logs
- audit access logs
- emergency revoke procedure
- vault signer pour DEX si live DEX un jour

Endpoints / jobs:
- TODO - GET /security/secrets-status
- TODO - POST /security/rotate-key
- TODO - POST /security/revoke-key
- TODO - GET /security/access-audit

Output attendu:

```json
{
  "secrets_status": "safe | warning | blocked",
  "rotation_required": [],
  "frontend_secret_leaks": 0,
  "log_secret_leaks": 0
}
```

## Etape 20 - Compliance Et Audit

Statut: TODO

But: pouvoir expliquer chaque decision, chaque rejet et chaque ordre.

A construire:
- audit trail immuable
- decision snapshots
- market data snapshot par decision
- risk snapshot par decision
- user action logs
- order lifecycle logs
- export CSV/JSON
- retention policy
- compliance notes
- recherche audit par trace_id / strategy_id / order_id

Endpoints:
- TODO - GET /audit/decisions
- TODO - GET /audit/orders
- TODO - GET /audit/export
- TODO - GET /audit/search

Output attendu:

```json
{
  "audit_status": "complete | incomplete | blocked",
  "decision_snapshot_available": true,
  "order_lifecycle_complete": true,
  "export_available": true
}
```

## Etape 21 - Disaster Recovery

Statut: TODO

But: survivre aux pannes sans dupliquer d'ordres ni perdre l'etat critique.

A construire:
- backup PostgreSQL
- backup strategy registry
- backup audit logs
- restore test
- failover Redis / Postgres
- exchange outage handling
- gateway outage handling
- restart from last safe state
- no duplicate order after restart
- disaster recovery drill

Endpoints / jobs:
- TODO - POST /dr/backup
- TODO - POST /dr/restore-test
- TODO - GET /dr/status

Output attendu:

```json
{
  "dr_status": "ready | degraded | blocked",
  "last_backup_at": "...",
  "last_restore_test_passed": true,
  "duplicate_order_protection": true
}
```

## Etape 22 - Live Trading Readiness Final

Statut: TODO

But: definir les conditions minimales avant live reel avec capital limite.

Prerequis obligatoires:
- paper trading multi-semaines positif
- drawdown sous limite
- backtest vs paper gap acceptable
- strategy governance active
- portfolio risk actif
- execution quality mesuree
- data lineage complet
- model risk acceptable
- kill switch teste
- audit complet
- secrets securises
- alerting actif
- disaster recovery teste
- capital limite initial
- validation humaine explicite

Endpoints:
- TODO - POST /live-readiness/final-review
- TODO - GET /live-readiness/final-review

Output attendu:

```json
{
  "live_readiness_final_status": "approved | rejected",
  "paper_track_record": {},
  "risk_limits": {},
  "open_blockers": [],
  "capital_limit": 0.0,
  "human_approval_required": true
}
```

## Ordre De Travail

1. Data Quality Engine
2. Transaction Cost + Slippage Engine
3. Walk-Forward Validation Engine
4. Feature Store
5. Microstructure Engine
6. Advanced Risk Engine
7. Portfolio Construction Avancee
8. Strategy Attribution
9. Experiment Tracker
10. Live Trading Readiness
11. Performance Evidence Long Terme
12. Strategy Governance
13. Research Factory Massive
14. Portfolio Risk Professionnel
15. Execution Quality Professionnelle
16. Data Quality Institutionnelle
17. Model Risk Management
18. Operations 24/7
19. Security Et Secrets Institutionnels
20. Compliance Et Audit
21. Disaster Recovery
22. Live Trading Readiness Final

## Regle De Suivi

- Une seule etape en IN_PROGRESS a la fois.
- Chaque etape doit etre branchee au backend existant.
- Chaque etape doit utiliser uniquement des donnees reelles.
- Chaque etape doit avoir des endpoints testables.
- Chaque etape doit etre verifiee end-to-end avant de passer a la suivante.
- Les modules termines doivent passer de TODO a DONE dans ce fichier.
- Les etapes 11 a 22 ne passent jamais DONE uniquement parce que le code existe: il faut aussi un rapport d'evidence, un test reproductible et une decision de promotion claire.
