from fastapi import APIRouter, HTTPException

from transaction_cost.engine import TransactionCostEngine, TransactionCostError
from transaction_cost.schemas import TransactionCostEstimate, TransactionCostRequest

router = APIRouter(prefix="/transaction-cost", tags=["transaction-cost"])
cost_engine = TransactionCostEngine()


@router.post("/estimate", response_model=TransactionCostEstimate)
async def estimate_transaction_cost(request: TransactionCostRequest | None = None) -> TransactionCostEstimate:
    try:
        return await cost_engine.estimate(request or TransactionCostRequest())
    except (TransactionCostError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/estimate", response_model=TransactionCostEstimate)
async def estimate_transaction_cost_get() -> TransactionCostEstimate:
    return await estimate_transaction_cost(TransactionCostRequest())
