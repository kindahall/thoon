from fastapi import APIRouter, HTTPException

from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError
from strategy_attribution.engine import StrategyAttributionEngine, StrategyAttributionError
from strategy_attribution.schemas import StrategyAttributionRequest, StrategyAttributionResult

router = APIRouter(prefix="/strategy-attribution", tags=["strategy-attribution"])
engine = StrategyAttributionEngine()


@router.post("/analyze", response_model=StrategyAttributionResult)
async def analyze_strategy_attribution(
    request: StrategyAttributionRequest | None = None,
) -> StrategyAttributionResult:
    try:
        return await engine.analyze(request or StrategyAttributionRequest())
    except (StrategyAttributionError, MarketDataError, BinanceAPIError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        if "vectorbt is required" in str(error):
            raise HTTPException(status_code=503, detail=str(error)) from error
        raise


@router.get("/analyze", response_model=StrategyAttributionResult)
async def analyze_strategy_attribution_get() -> StrategyAttributionResult:
    return await analyze_strategy_attribution(StrategyAttributionRequest())
