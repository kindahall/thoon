from fastapi import APIRouter, HTTPException

from gateway.llm_gateway import LLMGatewayError
from portfolio.advanced import AdvancedPortfolioConstructor, AdvancedPortfolioConstructionError
from portfolio.allocator import RegimeBasedAllocator
from portfolio.schemas import AdvancedPortfolioRequest, AdvancedPortfolioResult, PortfolioAllocationRequest, PortfolioAllocationResult
from services.binance import BinanceAPIError

router = APIRouter(prefix="/portfolio", tags=["portfolio"])
allocator = RegimeBasedAllocator()
advanced_constructor = AdvancedPortfolioConstructor()


@router.post("/allocate", response_model=PortfolioAllocationResult)
async def allocate_portfolio(request: PortfolioAllocationRequest | None = None) -> PortfolioAllocationResult:
    try:
        return await allocator.allocate(request or PortfolioAllocationRequest())
    except (ValueError, BinanceAPIError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except LLMGatewayError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/advanced/construct", response_model=AdvancedPortfolioResult)
async def construct_advanced_portfolio(request: AdvancedPortfolioRequest | None = None) -> AdvancedPortfolioResult:
    try:
        return await advanced_constructor.construct(request or AdvancedPortfolioRequest())
    except (AdvancedPortfolioConstructionError, ValueError, BinanceAPIError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
