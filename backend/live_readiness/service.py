from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from execution.audit import ExecutionAuditError, ExecutionAuditTrail, audit_trail
from execution.kill_switch import KillSwitchCommand, KillSwitchStatus
from execution.order_manager import ExecutionFill, ExecutionOrderResponse, OrderManager, PositionRecord
from live_readiness.schemas import (
    EmergencyShutdownRequest,
    ExchangeReadiness,
    LiveReadinessRequest,
    LiveReadinessResult,
    PositionReconciliation,
    ReadinessCheck,
)
from paper.engine import PaperTradingEngine
from paper.runtime import paper_engine


class LiveReadinessError(RuntimeError):
    pass


class LiveReadinessService:
    def __init__(
        self,
        *,
        order_manager: OrderManager,
        paper: PaperTradingEngine | None = None,
        audit: ExecutionAuditTrail | None = None,
    ) -> None:
        self.order_manager = order_manager
        self.paper = paper or paper_engine
        self.audit = audit or audit_trail

    async def check(self, request: LiveReadinessRequest) -> LiveReadinessResult:
        blockers: list[str] = []
        exchanges: list[ExchangeReadiness] = []
        reconciliations: list[PositionReconciliation] = []

        audit_check = self._audit_check(enabled=request.require_audit_trail)
        blockers.extend(audit_check.blockers)
        idempotency_check = self._idempotency_check()
        blockers.extend(idempotency_check.blockers)
        partial_fill_check = self._partial_fill_check()
        blockers.extend(partial_fill_check.blockers)
        risk_check = self._risk_limits_check()
        blockers.extend(risk_check.blockers)
        emergency_check = self._emergency_shutdown_check()
        blockers.extend(emergency_check.blockers)
        promotion_check = await self._paper_promotion_check(request)
        blockers.extend(promotion_check.blockers)

        for exchange in request.exchanges:
            exchange_readiness = await self._exchange_readiness(exchange=exchange, request=request)
            exchanges.append(exchange_readiness)
            blockers.extend(exchange_readiness.blockers)
            reconciliation = await self._position_reconciliation(exchange=exchange, request=request)
            reconciliations.append(reconciliation)
            blockers.extend(reconciliation.blockers)

        checks = [
            audit_check,
            idempotency_check,
            partial_fill_check,
            risk_check,
            emergency_check,
            promotion_check,
            *[self._exchange_check(item) for item in exchanges],
            *[self._reconciliation_check(item) for item in reconciliations],
        ]
        safety_score = round(sum(item.score for item in checks) / max(1, len(checks)), 8)
        unique_blockers = sorted(set(blockers))
        live_ready = not unique_blockers and safety_score >= request.min_safety_score

        return LiveReadinessResult(
            live_ready=live_ready,
            blockers=unique_blockers,
            safety_score=safety_score,
            exchanges=exchanges,
            position_reconciliation=reconciliations,
            audit_trail=audit_check,
            idempotency_keys=idempotency_check,
            partial_fills=partial_fill_check,
            paper_to_live_promotion=promotion_check,
            risk_limits=risk_check,
            emergency_shutdown=emergency_check,
            kill_switch=self.order_manager.kill_switch.status(),
            generated_at=datetime.now(UTC),
        )

    def emergency_shutdown(self, request: EmergencyShutdownRequest) -> KillSwitchStatus:
        status = self.order_manager.handle_kill_switch(
            KillSwitchCommand(action="trigger", reason="manual", detail=request.detail)
        )
        self.audit.record(
            event_type="live_readiness_emergency_shutdown",
            status="active" if status.active else "inactive",
            payload={"request": request.model_dump(mode="json"), "kill_switch": status.model_dump(mode="json")},
        )
        return status

    async def _exchange_readiness(self, *, exchange: str, request: LiveReadinessRequest) -> ExchangeReadiness:
        connector = self.order_manager._connector(exchange)
        blockers: list[str] = []
        latest_prices: dict[str, float] = {}
        public_market_data_ok = True

        for symbol in request.symbols:
            try:
                latest_prices[symbol] = round(float(await connector.get_market_price(symbol, request.category)), 8)
            except Exception as error:
                public_market_data_ok = False
                blockers.append(f"{exchange}_public_market_data_unavailable:{symbol}:{error}")

        credentials_present = connector.has_credentials()
        live_enabled = self.order_manager.live_trading_enabled
        live_execution_supported = self._connector_bool(connector, "live_execution_supported", default=True)
        wallet_signer_required = self._connector_bool(connector, "wallet_signer_required", default=False)
        permission_verified = False
        can_trade: bool | None = None
        withdrawals_enabled: bool | None = None
        source = f"{exchange}:public_market_price"

        if not live_execution_supported:
            blockers.append(f"{exchange}_live_execution_signer_not_enabled")
        if not live_enabled:
            blockers.append(f"{exchange}_live_trading_disabled")
        if not credentials_present:
            blockers.append(f"{exchange}_api_credentials_missing")
        elif request.check_api_permissions:
            try:
                permissions = await connector.get_account_permissions()
                permission_verified = True
                can_trade = bool(permissions.get("can_trade"))
                withdrawals_enabled = permissions.get("can_withdraw")
                source = str(permissions.get("source", source))
                if not can_trade:
                    blockers.append(f"{exchange}_api_key_cannot_trade")
                if withdrawals_enabled is True:
                    blockers.append(f"{exchange}_api_key_withdraw_permission_enabled")
            except Exception as error:
                blockers.append(f"{exchange}_api_permission_check_failed:{error}")

        return ExchangeReadiness(
            exchange=exchange,
            public_market_data_ok=public_market_data_ok,
            latest_prices=latest_prices,
            credentials_present=credentials_present,
            live_trading_enabled=live_enabled,
            live_execution_supported=live_execution_supported,
            wallet_signer_required=wallet_signer_required,
            permission_verified=permission_verified,
            can_trade=can_trade,
            withdrawals_enabled=withdrawals_enabled,
            blockers=blockers,
            source=source,
        )

    def _connector_bool(self, connector: object, method_name: str, *, default: bool) -> bool:
        method = getattr(connector, method_name, None)
        if method is None:
            return default
        try:
            return bool(method())
        except Exception:
            return default

    async def _position_reconciliation(self, *, exchange: str, request: LiveReadinessRequest) -> PositionReconciliation:
        if not request.check_live_positions:
            return PositionReconciliation(
                exchange=exchange,
                status="skipped",
                exchange_positions=[],
                system_positions=[],
                mismatches=[],
                blockers=[],
            )

        connector = self.order_manager._connector(exchange)
        if not self.order_manager.live_trading_enabled or not connector.has_credentials():
            return PositionReconciliation(
                exchange=exchange,
                status="blocked",
                exchange_positions=[],
                system_positions=[],
                mismatches=[],
                blockers=[f"{exchange}_live_position_reconciliation_unavailable"],
            )

        exchange_positions = await self.order_manager.get_open_positions(exchange=exchange, mode="live", category=request.category)
        system_positions = await self.order_manager.get_open_positions(exchange=exchange, mode="paper", category=request.category)
        mismatches = self._position_mismatches(exchange_positions=exchange_positions, system_positions=system_positions)
        blockers: list[str] = []
        if len(exchange_positions) > request.max_allowed_live_positions:
            blockers.append(f"{exchange}_live_positions_above_allowed_limit")
        if mismatches:
            blockers.append(f"{exchange}_position_reconciliation_mismatch")
        return PositionReconciliation(
            exchange=exchange,
            status="mismatch" if mismatches else "matched",
            exchange_positions=exchange_positions,
            system_positions=system_positions,
            mismatches=mismatches,
            blockers=blockers,
        )

    def _position_mismatches(
        self,
        *,
        exchange_positions: list[PositionRecord],
        system_positions: list[PositionRecord],
    ) -> list[str]:
        system_by_symbol = {position.symbol: position.quantity for position in system_positions}
        mismatches: list[str] = []
        for position in exchange_positions:
            system_quantity = system_by_symbol.get(position.symbol, 0.0)
            if abs(position.quantity - system_quantity) > 1e-10:
                mismatches.append(f"{position.symbol}:exchange={position.quantity}:system={system_quantity}")
        return mismatches

    def _audit_check(self, *, enabled: bool) -> ReadinessCheck:
        if not enabled:
            return ReadinessCheck(
                name="audit_trail",
                status="warning",
                score=0.5,
                blockers=[],
                details={"required": False},
            )
        try:
            health = self.audit.health_check()
        except ExecutionAuditError as error:
            return ReadinessCheck(
                name="audit_trail",
                status="blocked",
                score=0.0,
                blockers=[f"audit_trail_unavailable:{error}"],
                details={"required": True},
            )
        return ReadinessCheck(
            name="audit_trail",
            status="passed",
            score=1.0,
            blockers=[],
            details={
                "required": True,
                "available": bool(health["available"]),
                "path": str(health["path"]),
                "last_audit_id": str(health["last_audit_id"]),
            },
        )

    def _idempotency_check(self) -> ReadinessCheck:
        fields = ExecutionOrderResponse.model_fields
        has_store = hasattr(self.order_manager, "_idempotency")
        response_supports_client_order_id = "client_order_id" in fields
        passed = has_store and response_supports_client_order_id
        return ReadinessCheck(
            name="idempotency_keys",
            status="passed" if passed else "blocked",
            score=1.0 if passed else 0.0,
            blockers=[] if passed else ["idempotency_keys_not_enforced"],
            details={
                "client_order_id_supported": response_supports_client_order_id,
                "idempotency_store_enabled": has_store,
                "live_orders_require_client_order_id": True,
            },
        )

    def _partial_fill_check(self) -> ReadinessCheck:
        fields = ExecutionOrderResponse.model_fields
        fill_fields_present = all(field in fields for field in ("filled_quantity", "remaining_quantity", "fills"))
        fill_model_ready = set(ExecutionFill.model_fields) >= {"price", "quantity"}
        passed = fill_fields_present and fill_model_ready
        return ReadinessCheck(
            name="partial_fills",
            status="passed" if passed else "blocked",
            score=1.0 if passed else 0.0,
            blockers=[] if passed else ["partial_fill_fields_missing"],
            details={
                "filled_quantity_supported": "filled_quantity" in fields,
                "remaining_quantity_supported": "remaining_quantity" in fields,
                "fills_supported": "fills" in fields,
            },
        )

    async def _paper_promotion_check(self, request: LiveReadinessRequest) -> ReadinessCheck:
        if not request.require_paper_promotion_evidence:
            return ReadinessCheck(
                name="paper_to_live_promotion",
                status="warning",
                score=0.5,
                blockers=[],
                details={"required": False},
            )
        trades = await self.paper.trades(request.paper_symbol, limit=max(1, request.min_paper_trades))
        realized_pnl = round(sum(trade.realized_pnl_delta for trade in trades), 8)
        if len(trades) < request.min_paper_trades:
            return ReadinessCheck(
                name="paper_to_live_promotion",
                status="blocked",
                score=0.0,
                blockers=["paper_trading_evidence_missing"],
                details={
                    "required": True,
                    "paper_symbol": request.paper_symbol,
                    "paper_trades": len(trades),
                    "min_paper_trades": request.min_paper_trades,
                    "realized_pnl": realized_pnl,
                },
            )
        return ReadinessCheck(
            name="paper_to_live_promotion",
            status="passed",
            score=1.0,
            blockers=[],
            details={
                "required": True,
                "paper_symbol": request.paper_symbol,
                "paper_trades": len(trades),
                "min_paper_trades": request.min_paper_trades,
                "realized_pnl": realized_pnl,
            },
        )

    def _risk_limits_check(self) -> ReadinessCheck:
        settings = self.order_manager.risk_engine.settings
        blockers: list[str] = []
        if settings.max_leverage > 1.0:
            blockers.append("live_leverage_above_spot_safe_default")
        if settings.allow_short:
            blockers.append("short_selling_enabled")
        if settings.max_drawdown_fraction > 0.10:
            blockers.append("drawdown_limit_too_loose_for_live_readiness")
        return ReadinessCheck(
            name="risk_limits",
            status="passed" if not blockers else "blocked",
            score=1.0 if not blockers else 0.0,
            blockers=blockers,
            details={
                "max_order_notional": settings.max_order_notional,
                "max_position_notional": settings.max_position_notional,
                "max_total_exposure": settings.max_total_exposure,
                "max_leverage": settings.max_leverage,
                "allow_short": settings.allow_short,
                "max_drawdown_fraction": settings.max_drawdown_fraction,
            },
        )

    def _emergency_shutdown_check(self) -> ReadinessCheck:
        status = self.order_manager.kill_switch.status()
        if status.active:
            return ReadinessCheck(
                name="emergency_shutdown",
                status="blocked",
                score=0.0,
                blockers=["kill_switch_currently_active"],
                details=status.model_dump(mode="json"),
            )
        return ReadinessCheck(
            name="emergency_shutdown",
            status="passed",
            score=1.0,
            blockers=[],
            details={
                "kill_switch_active": False,
                "latency_threshold_ms": status.latency_threshold_ms,
                "api_error_spike_threshold": status.api_error_spike_threshold,
            },
        )

    def _exchange_check(self, readiness: ExchangeReadiness) -> ReadinessCheck:
        return ReadinessCheck(
            name=f"{readiness.exchange}_exchange_readiness",
            status="passed" if not readiness.blockers else "blocked",
            score=1.0 if not readiness.blockers else 0.0,
            blockers=readiness.blockers,
            details={
                "public_market_data_ok": readiness.public_market_data_ok,
                "credentials_present": readiness.credentials_present,
                "live_trading_enabled": readiness.live_trading_enabled,
                "live_execution_supported": readiness.live_execution_supported,
                "wallet_signer_required": readiness.wallet_signer_required,
                "permission_verified": readiness.permission_verified,
                "can_trade": readiness.can_trade,
                "withdrawals_enabled": readiness.withdrawals_enabled,
            },
        )

    def _reconciliation_check(self, reconciliation: PositionReconciliation) -> ReadinessCheck:
        if reconciliation.status == "skipped":
            score = 0.5
            status = "warning"
        elif reconciliation.blockers:
            score = 0.0
            status = "blocked"
        else:
            score = 1.0
            status = "passed"
        return ReadinessCheck(
            name=f"{reconciliation.exchange}_position_reconciliation",
            status=status,
            score=score,
            blockers=reconciliation.blockers,
            details={
                "status": reconciliation.status,
                "exchange_positions": len(reconciliation.exchange_positions),
                "system_positions": len(reconciliation.system_positions),
                "mismatches": len(reconciliation.mismatches),
            },
        )
