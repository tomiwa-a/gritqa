from fastapi import APIRouter

from ..config import settings

PROFILE = "/profile"

router = APIRouter(prefix="/customers")


@router.get("")
async def list_customers():
    return []


@router.get(PROFILE)
async def profile():
    return {}


@router.put(settings.profile_path)
async def update_profile():
    return {}
