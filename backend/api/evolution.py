from fastapi import APIRouter, HTTPException, Query

from evolution.evaluator import PerformanceEvaluator
from evolution.optimizer import EvolutionRequest, EvolutionResult, StrategyEvolutionEngine
from evolution.strategy_store import PerformanceRecord, StrategyRecord, StrategyRepository
from paper.engine import PaperTradingError
from paper.runtime import paper_engine
from services.binance import BinanceAPIError

router = APIRouter(prefix="/evolution", tags=["strategy-evolution"])
repository = StrategyRepository()
evaluator = PerformanceEvaluator()
engine = StrategyEvolutionEngine(repository=repository, evaluator=evaluator)


@router.post("/run", response_model=EvolutionResult)
async def evolve_strategy(request: EvolutionRequest | None = None) -> EvolutionResult:
    try:
        return await engine.run(request or EvolutionRequest())
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (BinanceAPIError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/feedback/paper/{strategy_id}/{symbol}", response_model=PerformanceRecord)
async def record_paper_feedback(
    strategy_id: str,
    symbol: str,
    limit: int = Query(default=1000, ge=1, le=1000),
) -> PerformanceRecord:
    try:
        trades = await paper_engine.trades(symbol, limit=limit)
        record = evaluator.evaluate_paper_trades(strategy_id=strategy_id, symbol=symbol, trades=trades)
        return repository.append_performance(record)
    except PaperTradingError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/strategies", response_model=list[StrategyRecord])
async def strategies() -> list[StrategyRecord]:
    return repository.list_strategies()


@router.get("/performance", response_model=list[PerformanceRecord])
async def performance(strategy_id: str | None = Query(default=None)) -> list[PerformanceRecord]:
    return repository.list_performance(strategy_id=strategy_id)
