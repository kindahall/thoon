from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from paper.schemas import PaperOrderRequest, PaperTradingState, PositionSnapshot, RiskLimits, TradeExecution
from services.binance import BinanceAPIError, normalize_symbol

EPSILON = 1e-12


class PaperTradingError(RuntimeError):
    pass


@dataclass
class MutablePosition:
    symbol: str
    quantity: float = 0.0
    average_entry_price: float = 0.0
    realized_pnl: float = 0.0


class PaperTradingEngine:
    def __init__(self, risk_limits: RiskLimits | None = None) -> None:
        self.risk_limits = risk_limits or RiskLimits()
        self._positions: dict[str, MutablePosition] = {}
        self._trades: list[TradeExecution] = []
        self._lock = asyncio.Lock()

    async def place_market_order(
        self,
        request: PaperOrderRequest,
        *,
        market_price: float,
        source: str,
        timestamp: datetime | None = None,
    ) -> TradeExecution:
        if market_price <= 0:
            raise PaperTradingError("market price must be positive")

        normalized_symbol = self._normalize_symbol(request.symbol)
        now = timestamp or datetime.now(UTC)

        async with self._lock:
            position = self._position(normalized_symbol)
            self._check_risk(position, request, market_price, now)
            notional = request.quantity * market_price
            fee = notional * self.risk_limits.fee_rate
            realized_delta = self._apply_fill(position, request.side, request.quantity, market_price, fee)

            trade = TradeExecution(
                id=str(uuid4()),
                symbol=normalized_symbol,
                side=request.side,
                status="filled",
                quantity=round(request.quantity, 12),
                price=round(market_price, 8),
                notional=round(notional, 8),
                fee=round(fee, 8),
                realized_pnl_delta=round(realized_delta, 8),
                position_quantity_after=round(position.quantity, 12),
                average_entry_price_after=round(position.average_entry_price, 8),
                source=source,
                timestamp=now,
                client_order_id=request.client_order_id,
            )
            self._trades.append(trade)
            return trade

    async def mark_to_market(
        self,
        symbol: str,
        *,
        market_price: float,
        source: str,
        timestamp: datetime | None = None,
    ) -> PaperTradingState:
        if market_price <= 0:
            raise PaperTradingError("market price must be positive")

        normalized_symbol = self._normalize_symbol(symbol)
        now = timestamp or datetime.now(UTC)

        async with self._lock:
            position = self._position(normalized_symbol)
            return self._state_locked(position, market_price=market_price, source=source, timestamp=now)

    async def trades(self, symbol: str, *, limit: int = 100) -> list[TradeExecution]:
        normalized_symbol = self._normalize_symbol(symbol)
        safe_limit = max(1, min(limit, 1000))
        async with self._lock:
            return [trade for trade in self._trades if trade.symbol == normalized_symbol][-safe_limit:]

    async def get_risk_limits(self) -> RiskLimits:
        async with self._lock:
            return self.risk_limits

    async def set_risk_limits(self, risk_limits: RiskLimits) -> RiskLimits:
        async with self._lock:
            self.risk_limits = risk_limits
            return self.risk_limits

    async def reset(self, symbol: str | None = None) -> None:
        async with self._lock:
            if symbol is None:
                self._positions.clear()
                self._trades.clear()
                return

            normalized_symbol = self._normalize_symbol(symbol)
            self._positions.pop(normalized_symbol, None)
            self._trades = [trade for trade in self._trades if trade.symbol != normalized_symbol]

    def _position(self, symbol: str) -> MutablePosition:
        if symbol not in self._positions:
            self._positions[symbol] = MutablePosition(symbol=symbol)
        return self._positions[symbol]

    def _check_risk(
        self,
        position: MutablePosition,
        request: PaperOrderRequest,
        market_price: float,
        timestamp: datetime,
    ) -> None:
        notional = request.quantity * market_price
        signed_quantity = request.quantity if request.side == "buy" else -request.quantity
        projected_quantity = position.quantity + signed_quantity
        projected_notional = abs(projected_quantity * market_price)

        if notional > self.risk_limits.max_order_notional:
            raise PaperTradingError("risk limit breached: max_order_notional")
        if abs(projected_quantity) > self.risk_limits.max_abs_quantity:
            raise PaperTradingError("risk limit breached: max_abs_quantity")
        if projected_notional > self.risk_limits.max_position_notional:
            raise PaperTradingError("risk limit breached: max_position_notional")
        if not self.risk_limits.allow_short and projected_quantity < -EPSILON:
            raise PaperTradingError("risk limit breached: short selling disabled")
        if position.realized_pnl <= -self.risk_limits.max_realized_loss:
            raise PaperTradingError("risk limit breached: max_realized_loss")
        if self._daily_trade_count(position.symbol, timestamp) >= self.risk_limits.max_daily_trades:
            raise PaperTradingError("risk limit breached: max_daily_trades")

    def _apply_fill(
        self,
        position: MutablePosition,
        side: str,
        quantity: float,
        price: float,
        fee: float,
    ) -> float:
        signed_quantity = quantity if side == "buy" else -quantity
        realized_delta = -fee

        if abs(position.quantity) < EPSILON:
            position.quantity = signed_quantity
            position.average_entry_price = price
            position.realized_pnl += realized_delta
            self._normalize_flat_position(position)
            return realized_delta

        if position.quantity > 0:
            realized_delta += self._apply_fill_against_long(position, signed_quantity, price)
        else:
            realized_delta += self._apply_fill_against_short(position, signed_quantity, price)

        position.realized_pnl += realized_delta
        self._normalize_flat_position(position)
        return realized_delta

    def _apply_fill_against_long(self, position: MutablePosition, signed_quantity: float, price: float) -> float:
        if signed_quantity > 0:
            new_quantity = position.quantity + signed_quantity
            position.average_entry_price = (
                (position.average_entry_price * position.quantity) + (price * signed_quantity)
            ) / new_quantity
            position.quantity = new_quantity
            return 0.0

        close_quantity = min(position.quantity, abs(signed_quantity))
        realized_delta = (price - position.average_entry_price) * close_quantity
        remaining = position.quantity + signed_quantity
        position.quantity = remaining
        if remaining < -EPSILON:
            position.average_entry_price = price
        return realized_delta

    def _apply_fill_against_short(self, position: MutablePosition, signed_quantity: float, price: float) -> float:
        if signed_quantity < 0:
            current_abs = abs(position.quantity)
            add_abs = abs(signed_quantity)
            new_abs = current_abs + add_abs
            position.average_entry_price = ((position.average_entry_price * current_abs) + (price * add_abs)) / new_abs
            position.quantity -= add_abs
            return 0.0

        close_quantity = min(abs(position.quantity), signed_quantity)
        realized_delta = (position.average_entry_price - price) * close_quantity
        remaining = position.quantity + signed_quantity
        position.quantity = remaining
        if remaining > EPSILON:
            position.average_entry_price = price
        return realized_delta

    def _state_locked(
        self,
        position: MutablePosition,
        *,
        market_price: float,
        source: str,
        timestamp: datetime,
    ) -> PaperTradingState:
        unrealized = self._unrealized_pnl(position, market_price)
        market_value = position.quantity * market_price
        trades_for_symbol = [trade for trade in self._trades if trade.symbol == position.symbol]
        snapshot = PositionSnapshot(
            symbol=position.symbol,
            quantity=round(position.quantity, 12),
            average_entry_price=round(position.average_entry_price, 8),
            market_price=round(market_price, 8),
            market_value=round(market_value, 8),
            realized_pnl=round(position.realized_pnl, 8),
            unrealized_pnl=round(unrealized, 8),
            total_pnl=round(position.realized_pnl + unrealized, 8),
            updated_at=timestamp,
        )
        return PaperTradingState(
            symbol=position.symbol,
            position=snapshot,
            risk_limits=self.risk_limits,
            trades_count=len(trades_for_symbol),
            last_trade=trades_for_symbol[-1] if trades_for_symbol else None,
            source=source,
            timestamp=timestamp,
        )

    def _unrealized_pnl(self, position: MutablePosition, market_price: float) -> float:
        if position.quantity > EPSILON:
            return (market_price - position.average_entry_price) * position.quantity
        if position.quantity < -EPSILON:
            return (position.average_entry_price - market_price) * abs(position.quantity)
        return 0.0

    def _normalize_flat_position(self, position: MutablePosition) -> None:
        if abs(position.quantity) < EPSILON:
            position.quantity = 0.0
            position.average_entry_price = 0.0

    def _daily_trade_count(self, symbol: str, timestamp: datetime) -> int:
        trade_date = timestamp.astimezone(UTC).date()
        return sum(1 for trade in self._trades if trade.symbol == symbol and trade.timestamp.astimezone(UTC).date() == trade_date)

    def _normalize_symbol(self, symbol: str) -> str:
        try:
            return normalize_symbol(symbol)
        except BinanceAPIError as error:
            raise PaperTradingError(str(error)) from error
