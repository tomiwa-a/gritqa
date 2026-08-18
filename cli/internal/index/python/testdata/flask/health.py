from flask import Blueprint

health_bp = Blueprint("health", __name__, url_prefix="/health")

READY_METHODS = ["GET"]


@health_bp.route("/")
def health():
    return {"ok": True}


@health_bp.route("/ready", methods=READY_METHODS)
def ready():
    return {"ok": True}
