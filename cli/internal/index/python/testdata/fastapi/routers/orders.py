from fastapi import APIRouter, Depends

from ..auth import require_auth

router = APIRouter(
    prefix="/orders",
    tags=["orders"],
    dependencies=[Depends(require_auth)],
)


@router.get("")
async def list_orders():
    return []


@router.post("")
async def create_order():
    return {}


@router.get("/{order_id}")
async def get_order(order_id: int):
    return {}


@router.delete("/{order_id}")
async def delete_order(order_id: int):
    return None
