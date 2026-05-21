from fastapi import APIRouter, HTTPException, Query

from experiment_tracker.schemas import ExperimentRecord, ExperimentStatus, ExperimentTrackerRequest
from experiment_tracker.service import ExperimentTrackerError, ExperimentTrackerService
from experiment_tracker.storage import PostgresExperimentStoreError
from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError

router = APIRouter(prefix="/experiments", tags=["experiments"])
service = ExperimentTrackerService()


@router.post("/track", response_model=ExperimentRecord)
async def track_experiment(request: ExperimentTrackerRequest | None = None) -> ExperimentRecord:
    try:
        return await service.track(request or ExperimentTrackerRequest())
    except PostgresExperimentStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (ExperimentTrackerError, BinanceAPIError, MarketDataError, ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("", response_model=list[ExperimentRecord])
async def list_experiments(
    status: ExperimentStatus | None = Query(default=None),
    symbol: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[ExperimentRecord]:
    try:
        normalized_symbol = symbol.upper() if symbol else None
        return await service.list(limit=limit, status=status, symbol=normalized_symbol)
    except PostgresExperimentStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.get("/{experiment_id}", response_model=ExperimentRecord)
async def get_experiment(experiment_id: str) -> ExperimentRecord:
    try:
        return await service.get(experiment_id)
    except PostgresExperimentStoreError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
