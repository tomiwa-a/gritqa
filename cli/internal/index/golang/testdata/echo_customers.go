package fixtures

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

type CustomerHandler struct{}

func MountCustomers(e *echo.Echo, h *CustomerHandler) {
	g := e.Group("/customers", AuthMiddleware)

	g.GET("/", h.List)
	g.POST("/", h.Create)
	g.GET("/:id", h.Get)
	g.PATCH("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.GET("/:id/orders", h.Orders)
	g.Add(http.MethodGet, "/:id/cards", h.Cards)
	g.POST("/:id/cards", h.AddCard)
	g.PUT("/:id/cards/:cardId", h.UpdateCard)
	g.POST("/import", h.Import)
}
