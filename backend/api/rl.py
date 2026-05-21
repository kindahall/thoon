from fastapi import APIRouter, HTTPException

from paper.engine import PaperTradingError
from rl.data_loader import MarketDataError
from rl.schemas import RLPaperValidationRequest, RLPaperValidationResult, RLTrainRequest, RLTrainResult
from rl.trainer import RLPaperValidationService, RLTrainingService
from services.binance import BinanceAPIError

router = APIRouter(prefix="/rl", tags=["reinforcement-learning"])
training_service = RLTrainingService()
paper_validation_service = RLPaperValidationService()


@router.post("/train", response_model=RLTrainResult)
async def train_rl_agent(request: RLTrainRequest | None = None) -> RLTrainResult:
    try:
        return await training_service.train(request or RLTrainRequest())
    except ImportError as error:
        raise HTTPException(status_code=503, detail=f"RL dependencies unavailable: {error}") from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (ValueError, BinanceAPIError, MarketDataError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/paper/validate", response_model=RLPaperValidationResult)
async def validate_rl_agent_paper(request: RLPaperValidationRequest) -> RLPaperValidationResult:
    try:
        return await paper_validation_service.validate(request)
    except ImportError as error:
        raise HTTPException(status_code=503, detail=f"RL dependencies unavailable: {error}") from error
    except PaperTradingError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (ValueError, BinanceAPIError, MarketDataError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
