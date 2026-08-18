from flask import Blueprint

bp = Blueprint("orders", __name__, url_prefix="/orders")


@bp.route("/", methods=["GET", "POST"])
def orders():
    return []


@bp.get("/<int:order_id>")
def get_order(order_id):
    return {}


@bp.route("/<order_id>/events", methods=["GET", "HEAD"])
def events(order_id):
    return []
