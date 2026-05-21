from fastapi import APIRouter, HTTPException, Query

from paper.engine import PaperTradingError
from paper.runtime import binance_client, paper_engine
from paper.schemas import PaperOrderRequest, PaperTradingState, RiskLimits, TradeExecution
from services.binance import BinanceAPIError
from observability.metrics import record_paper_state

router = APIRouter(prefix="/paper", tags=["paper-trading"])


@router.get("/risk-limits", response_model=RiskLimits)
async def risk_limits() -> RiskLimits:
    return await paper_engine.get_risk_limits()


@router.post("/risk-limits", response_model=RiskLimits)
async def update_risk_limits(request: RiskLimits) -> RiskLimits:
    return await paper_engine.set_risk_limits(request)


@router.post("/orders", response_model=TradeExecution)
async def place_order(request: PaperOrderRequest) -> TradeExecution:
    try:
        price = await binance_client.get_price(request.symbol)
        return await paper_engine.place_market_order(
            request,
            market_price=price.price,
            source="binance_rest",
        )
    except PaperTradingError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except BinanceAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/{symbol}/state", response_model=PaperTradingState)
async def state(symbol: str) -> PaperTradingState:
    try:
        price = await binance_client.get_price(symbol)
        paper_state = await paper_engine.mark_to_market(
            price.symbol,
            market_price=price.price,
            source="binance_rest",
        )
        record_paper_state(paper_state)
        return paper_state
    except PaperTradingError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except BinanceAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/{symbol}/pnl", response_model=PaperTradingState)
async def pnl(symbol: str) -> PaperTradingState:
    return await state(symbol)


@router.get("/{symbol}/trades", response_model=list[TradeExecution])
async def trades(symbol: str, limit: int = Query(default=100, ge=1, le=1000)) -> list[TradeExecution]:
    try:
        return await paper_engine.trades(symbol, limit=limit)
    except PaperTradingError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/{symbol}/reset", status_code=204)
async def reset_symbol(symbol: str) -> None:
    try:
        await paper_engine.reset(symbol)
    except PaperTradingError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
