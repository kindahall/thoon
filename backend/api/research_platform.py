from fastapi import APIRouter, HTTPException, Query

from paper.engine import PaperTradingError
from paper.runtime import paper_engine
from research_platform.loop import ResearchLoopController
from research_platform.registry import StrategyRegistryError
from research_platform.schemas import (
    PaperResultRecord,
    QuantResearchOutput,
    QuantResearchRequest,
    ResearchRunRecord,
    StrategyEvaluationRecord,
    StrategyRegistryInput,
    StrategyRegistryRecord,
)
from research_platform.storage import PostgresResearchStoreError
from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError

router = APIRouter(prefix="/research-platform", tags=["research-platform"])
controller = ResearchLoopController()


@router.post("/run", response_model=QuantResearchOutput)
async def run_quant_research(request: QuantResearchRequest | None = None) -> QuantResearchOutput:
    try:
        return await controller.run(request or QuantResearchRequest())
    except PostgresResearchStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (BinanceAPIError, MarketDataError, ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/strategies", response_model=StrategyRegistryRecord)
async def register_strategy(strategy: StrategyRegistryInput) -> StrategyRegistryRecord:
    try:
        return await controller.register_strategy(strategy)
    except PostgresResearchStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except StrategyRegistryError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/strategies", response_model=list[StrategyRegistryRecord])
async def list_strategies(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[StrategyRegistryRecord]:
    try:
        return await controller.list_strategies(limit=limit, status=status)
    except PostgresResearchStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.get("/evaluations", response_model=list[StrategyEvaluationRecord])
async def list_evaluations(
    strategy_id: str | None = Query(default=None),
    selection_status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[StrategyEvaluationRecord]:
    try:
        return await controller.list_evaluations(
            limit=limit,
            strategy_id=strategy_id,
            selection_status=selection_status,
        )
    except PostgresResearchStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.get("/runs", response_model=list[ResearchRunRecord])
async def list_runs(limit: int = Query(default=50, ge=1, le=500)) -> list[ResearchRunRecord]:
    try:
        return await controller.list_runs(limit=limit)
    except PostgresResearchStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/paper-feedback/{strategy_id}/{symbol}", response_model=PaperResultRecord)
async def record_paper_feedback(
    strategy_id: str,
    symbol: str,
    limit: int = Query(default=1000, ge=1, le=1000),
) -> PaperResultRecord:
    try:
        trades = await paper_engine.trades(symbol, limit=limit)
        return await controller.record_paper_feedback(strategy_id=strategy_id, symbol=symbol, trades=trades)
    except PostgresResearchStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (PaperTradingError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
