from fastapi import APIRouter, HTTPException

from agents.macro_market import MacroAnalysis, MacroAnalyzeRequest, MacroMarketAgent
from gateway.llm_gateway import LLMGatewayError

router = APIRouter(prefix="/macro", tags=["macro"])
macro_agent = MacroMarketAgent()


@router.post("/analyze", response_model=MacroAnalysis)
async def analyze_macro(request: MacroAnalyzeRequest | None = None) -> MacroAnalysis:
    try:
        return await macro_agent.analyze(request or MacroAnalyzeRequest())
    except (LLMGatewayError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

@router.get("/analyze", response_model=MacroAnalysis)
async def analyze_macro_get() -> MacroAnalysis:
    return await analyze_macro(MacroAnalyzeRequest())
