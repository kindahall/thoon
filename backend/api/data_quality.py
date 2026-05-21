from fastapi import APIRouter, HTTPException

from data_quality.engine import DataQualityEngine, DataQualityError
from data_quality.schemas import DataQualityRequest, DataQualityResult
from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError

router = APIRouter(prefix="/data-quality", tags=["data-quality"])
quality_engine = DataQualityEngine()


@router.post("/check", response_model=DataQualityResult)
async def check_data_quality(request: DataQualityRequest | None = None) -> DataQualityResult:
    try:
        return await quality_engine.check(request or DataQualityRequest())
    except (DataQualityError, MarketDataError, BinanceAPIError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/check", response_model=DataQualityResult)
async def check_data_quality_get() -> DataQualityResult:
    return await check_data_quality(DataQualityRequest())
