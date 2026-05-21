from fastapi import APIRouter, HTTPException

from api.execution import order_manager
from execution.audit import ExecutionAuditError
from execution.kill_switch import KillSwitchStatus
from live_readiness.schemas import EmergencyShutdownRequest, LiveReadinessRequest, LiveReadinessResult
from live_readiness.service import LiveReadinessError, LiveReadinessService

router = APIRouter(prefix="/live-readiness", tags=["live-readiness"])
service = LiveReadinessService(order_manager=order_manager)


@router.post("/check", response_model=LiveReadinessResult)
async def check_live_readiness(request: LiveReadinessRequest | None = None) -> LiveReadinessResult:
    try:
        return await service.check(request or LiveReadinessRequest())
    except ExecutionAuditError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except LiveReadinessError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/check", response_model=LiveReadinessResult)
async def check_live_readiness_get() -> LiveReadinessResult:
    return await check_live_readiness(LiveReadinessRequest())


@router.post("/emergency-shutdown", response_model=KillSwitchStatus)
async def emergency_shutdown(request: EmergencyShutdownRequest | None = None) -> KillSwitchStatus:
    try:
        return service.emergency_shutdown(request or EmergencyShutdownRequest())
    except ExecutionAuditError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
