from fastapi import APIRouter, HTTPException

from microstructure.engine import MicrostructureEngine, MicrostructureError
from microstructure.schemas import MicrostructureAnalysis, MicrostructureRequest

router = APIRouter(prefix="/microstructure", tags=["microstructure"])
engine = MicrostructureEngine()


@router.post("/analyze", response_model=MicrostructureAnalysis)
async def analyze_microstructure(request: MicrostructureRequest | None = None) -> MicrostructureAnalysis:
    try:
        return await engine.analyze(request or MicrostructureRequest())
    except MicrostructureError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/analyze", response_model=MicrostructureAnalysis)
async def analyze_microstructure_get() -> MicrostructureAnalysis:
    return await analyze_microstructure(MicrostructureRequest())
