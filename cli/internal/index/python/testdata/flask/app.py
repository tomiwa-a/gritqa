from flask import Flask

from .health import health_bp
from .orders import bp as orders_bp

app = Flask(__name__)

app.register_blueprint(orders_bp, url_prefix="/v1/orders")
app.register_blueprint(health_bp)
