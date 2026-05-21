from fastapi import APIRouter, HTTPException

from macro_quant.data_engine import CrossAssetDataError
from macro_quant.schemas import CrossAssetMacroOutput, CrossAssetMacroRequest
from macro_quant.service import CrossAssetMacroTradingSystem
from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError

router = APIRouter(prefix="/macro-quant", tags=["macro-quant"])
macro_quant_system = CrossAssetMacroTradingSystem()


@router.post("/analyze", response_model=CrossAssetMacroOutput)
async def analyze_cross_asset_macro(request: CrossAssetMacroRequest | None = None) -> CrossAssetMacroOutput:
    try:
        return await macro_quant_system.analyze(request or CrossAssetMacroRequest())
    except (CrossAssetDataError, MarketDataError, BinanceAPIError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/analyze", response_model=CrossAssetMacroOutput)
async def analyze_cross_asset_macro_get() -> CrossAssetMacroOutput:
    return await analyze_cross_asset_macro(CrossAssetMacroRequest())
