from fastapi import APIRouter, HTTPException, Query

from feature_store.schemas import FeatureSetRecord, FeatureStoreRequest
from feature_store.service import FeatureStoreError, FeatureStoreService
from feature_store.storage import PostgresFeatureStoreError
from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError

router = APIRouter(prefix="/feature-store", tags=["feature-store"])
service = FeatureStoreService()


@router.post("/compute", response_model=FeatureSetRecord)
async def compute_features(request: FeatureStoreRequest | None = None) -> FeatureSetRecord:
    try:
        return await service.compute(request or FeatureStoreRequest())
    except PostgresFeatureStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (FeatureStoreError, MarketDataError, BinanceAPIError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/sets/{feature_set_id}", response_model=FeatureSetRecord)
async def get_feature_set(feature_set_id: str) -> FeatureSetRecord:
    try:
        return service.get_feature_set(feature_set_id)
    except PostgresFeatureStoreError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/latest", response_model=FeatureSetRecord)
async def latest_feature_set() -> FeatureSetRecord:
    try:
        return service.latest()
    except PostgresFeatureStoreError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/sets", response_model=list[FeatureSetRecord])
async def list_feature_sets(
    exchange: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[FeatureSetRecord]:
    try:
        return service.list_feature_sets(limit=limit, exchange=exchange)
    except PostgresFeatureStoreError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
