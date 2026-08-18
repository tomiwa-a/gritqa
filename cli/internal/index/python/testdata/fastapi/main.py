from fastapi import Depends, FastAPI

from .auth import require_admin
from .routers import orders
from .routers.customers import router as customers_router

app = FastAPI()

app.include_router(orders.router, prefix="/v1")
app.include_router(
    customers_router,
    prefix="/v1",
    dependencies=[Depends(require_admin)],
)


@app.get("/health")
async def health():
    return {"ok": True}
