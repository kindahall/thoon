from fastapi import APIRouter, HTTPException

from gateway.llm_gateway import LLMGatewayError
from orchestrator.graph import StrategyOrchestrator
from orchestrator.nodes import OrchestrationNodeError
from orchestrator.schemas import OrchestrationRequest, StrategyOrchestrationResult
from services.binance import BinanceAPIError

router = APIRouter(prefix="/orchestrate", tags=["orchestration"])
strategy_orchestrator = StrategyOrchestrator()


@router.post("/strategy", response_model=StrategyOrchestrationResult)
async def orchestrate_strategy(request: OrchestrationRequest | None = None) -> StrategyOrchestrationResult:
    try:
        return await strategy_orchestrator.run(request or OrchestrationRequest())
    except (ValueError, OrchestrationNodeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except BinanceAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except LLMGatewayError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
