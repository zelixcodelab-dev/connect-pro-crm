"""Public (tenant-scoped) read of the global CRM pipeline configuration.

Any signed-in company user can read the pipeline so the CRM board, funnel and
filters render the platform owner's custom labels/order/visibility. Editing is
platform-owner-only (see routers/platform.py).
"""
from fastapi import APIRouter, Depends

from auth_lib import get_current_user
from lib.pipeline import get_pipeline_stages

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


@router.get("")
async def read_pipeline(user: dict = Depends(get_current_user)):
    return {"stages": await get_pipeline_stages()}
