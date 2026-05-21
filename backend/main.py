import os

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from api.advanced_risk import router as advanced_risk_router
from api.arbitrage import router as arbitrage_router
from api.backtest import router as backtest_router
from api.data_quality import router as data_quality_router
from api.evolution import router as evolution_router
from api.execution import router as execution_router
from api.experiments import router as experiments_router
from api.feature_store import router as feature_store_router
from api.live_readiness import router as live_readiness_router
from api.macro import router as macro_router
from api.macro_quant import router as macro_quant_router
from api.market import router as market_router
from api.microstructure import router as microstructure_router
from api.orchestrate import router as orchestrate_router
from api.paper import router as paper_router
from api.portfolio import router as portfolio_router
from api.research import router as research_router
from api.research_platform import router as research_platform_router
from api.rl import router as rl_router
from api.strategy_attribution import router as strategy_attribution_router
from api.transaction_cost import router as transaction_cost_router
from api.walk_forward import router as walk_forward_router
from ws.market import router as market_ws_router
from ws.paper import router as paper_ws_router
from observability.logging_config import configure_logging
from observability.middleware import ObservabilityMiddleware
from observability.tracing import configure_tracing

configure_logging()


def _allowed_origins() -> list[str]:
    raw_origins = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


app = FastAPI(title="Thoon/Bud Quant Backend", version="1.0.0")

app.add_middleware(ObservabilityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(market_router)
app.include_router(microstructure_router)
app.include_router(advanced_risk_router)
app.include_router(macro_router)
app.include_router(macro_quant_router)
app.include_router(data_quality_router)
app.include_router(backtest_router)
app.include_router(evolution_router)
app.include_router(paper_router)
app.include_router(orchestrate_router)
app.include_router(execution_router)
app.include_router(experiments_router)
app.include_router(feature_store_router)
app.include_router(live_readiness_router)
app.include_router(portfolio_router)
app.include_router(rl_router)
app.include_router(arbitrage_router)
app.include_router(research_router)
app.include_router(research_platform_router)
app.include_router(strategy_attribution_router)
app.include_router(transaction_cost_router)
app.include_router(walk_forward_router)
app.include_router(market_ws_router)
app.include_router(paper_ws_router)
configure_tracing(app)


@app.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
