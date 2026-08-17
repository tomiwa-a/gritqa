package fixtures

import "github.com/gin-gonic/gin"

type OrderHandler struct{}

func MountOrders(r *gin.Engine, h *OrderHandler) {
	orders := r.Group("/orders")
	orders.Use(AuthRequired())
	{
		orders.GET("/", h.List)
		orders.POST("/", h.Create)
		orders.GET("/:id", h.Get)
		orders.PATCH("/:id", h.Update)
		orders.DELETE("/:id", h.Delete)
		orders.POST("/:id/confirm", h.Confirm)
		orders.POST("/:id/cancel", h.Cancel)
		orders.GET("/:id/items", h.Items)
		orders.POST("/:id/items", h.AddItem)
	}
}
