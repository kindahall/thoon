from fastapi import APIRouter, HTTPException

from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError
from walk_forward.engine import WalkForwardValidationEngine, WalkForwardValidationError
from walk_forward.schemas import WalkForwardRequest, WalkForwardValidationResult

router = APIRouter(prefix="/walk-forward", tags=["walk-forward"])
engine = WalkForwardValidationEngine()


@router.post("/validate", response_model=WalkForwardValidationResult)
async def validate_walk_forward(request: WalkForwardRequest | None = None) -> WalkForwardValidationResult:
    try:
        return await engine.validate(request or WalkForwardRequest())
    except (WalkForwardValidationError, MarketDataError, BinanceAPIError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/validate", response_model=WalkForwardValidationResult)
async def validate_walk_forward_get() -> WalkForwardValidationResult:
    return await validate_walk_forward(WalkForwardRequest())
