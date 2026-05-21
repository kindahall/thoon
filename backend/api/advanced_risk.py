from fastapi import APIRouter, HTTPException

from advanced_risk.engine import AdvancedRiskEngine, AdvancedRiskError
from advanced_risk.schemas import AdvancedRiskRequest, AdvancedRiskResult
from microstructure.engine import MicrostructureError
from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError

router = APIRouter(prefix="/risk", tags=["advanced-risk"])
engine = AdvancedRiskEngine()


@router.post("/advanced/analyze", response_model=AdvancedRiskResult)
async def analyze_advanced_risk(request: AdvancedRiskRequest | None = None) -> AdvancedRiskResult:
    try:
        return await engine.analyze(request or AdvancedRiskRequest())
    except (AdvancedRiskError, MarketDataError, BinanceAPIError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except MicrostructureError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/advanced/analyze", response_model=AdvancedRiskResult)
async def analyze_advanced_risk_get() -> AdvancedRiskResult:
    return await analyze_advanced_risk(AdvancedRiskRequest())
