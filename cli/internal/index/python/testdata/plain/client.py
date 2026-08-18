import httpx

from .rate import Blueprint

client = httpx.Client(base_url="https://api.example.com")

# A local class that happens to share a framework's name. Reading its routes
# would invent four endpoints nobody can call.
limiter = Blueprint("limits", url_prefix="/internal")


@limiter.get("/limits")
def limits():
    return {}


def fetch_orders():
    return client.get("/v1/orders", timeout=5)


def store(key, value):
    cache.put("/tmp/orders", value)
    cache.delete("/tmp/orders")


@retry(attempts=3)
def sync():
    session.post("/v1/sync", json={})
