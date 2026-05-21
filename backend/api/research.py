from fastapi import APIRouter, HTTPException, Query

from gateway.llm_gateway import LLMGatewayError
from research.graph import AutonomousResearchLab
from research.memory import ResearchMemoryStore
from research.schemas import PerformanceEvolutionPoint, ResearchLabOutput, ResearchLabRequest, ResearchStrategyResult
from rl.data_loader import MarketDataError
from services.binance import BinanceAPIError

router = APIRouter(prefix="/research", tags=["autonomous-research"])
memory = ResearchMemoryStore()
research_lab = AutonomousResearchLab()


@router.post("/run", response_model=ResearchLabOutput)
async def run_research_lab(request: ResearchLabRequest | None = None) -> ResearchLabOutput:
    try:
        return await research_lab.run(request or ResearchLabRequest())
    except (LLMGatewayError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (BinanceAPIError, MarketDataError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/strategies", response_model=list[ResearchStrategyResult])
async def research_strategies(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[ResearchStrategyResult]:
    return memory.list_strategies(status=status, limit=limit)


@router.get("/performance", response_model=list[PerformanceEvolutionPoint])
async def research_performance(limit: int = Query(default=50, ge=1, le=500)) -> list[PerformanceEvolutionPoint]:
    return memory.list_runs(limit=limit)
