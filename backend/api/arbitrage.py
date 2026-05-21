from fastapi import APIRouter, HTTPException

from arbitrage.market_data import ArbitrageDataError
from arbitrage.schemas import (
    ArbitragePaperExecutionRequest,
    ArbitragePaperExecutionResponse,
    ArbitrageScanRequest,
    ArbitrageScanResponse,
)
from arbitrage.service import ArbitrageService

router = APIRouter(prefix="/arbitrage", tags=["arbitrage"])
arbitrage_service = ArbitrageService()


@router.post("/scan", response_model=ArbitrageScanResponse)
async def scan_arbitrage(request: ArbitrageScanRequest | None = None) -> ArbitrageScanResponse:
    try:
        return await arbitrage_service.scan(request or ArbitrageScanRequest())
    except ArbitrageDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/paper/execute", response_model=ArbitragePaperExecutionResponse)
async def execute_arbitrage_paper(request: ArbitragePaperExecutionRequest | None = None) -> ArbitragePaperExecutionResponse:
    try:
        return await arbitrage_service.execute_paper(request or ArbitragePaperExecutionRequest())
    except ArbitrageDataError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
