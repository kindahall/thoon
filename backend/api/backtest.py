from fastapi import APIRouter, HTTPException

from backtest.runner import BacktestRequest, BacktestResult, BacktestRunner
from observability.metrics import record_drawdown, record_win_rate
from services.binance import BinanceAPIError

router = APIRouter(prefix="/backtest", tags=["backtest"])
runner = BacktestRunner()


@router.post("/run", response_model=BacktestResult)
async def run_backtest(request: BacktestRequest | None = None) -> BacktestResult:
    try:
        result = await runner.run(request or BacktestRequest())
        record_win_rate("backtest", result.symbol, result.metrics.win_rate)
        record_drawdown("binance", "backtest", result.symbol, result.metrics.max_drawdown)
        return result
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (BinanceAPIError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
