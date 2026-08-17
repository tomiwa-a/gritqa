package fixtures

import "github.com/gofiber/fiber/v2"

const invoicePrefix = "/invoices"

type InvoiceHandler struct{}

func MountInvoices(app *fiber.App, h *InvoiceHandler) {
	api := app.Group(invoicePrefix, RequireAPIKey)

	api.Get("/", h.List)
	api.Post("/", h.Create)
	api.Get("/:id", h.Get)
	api.Post("/:id/send", h.Send)
	api.Get("/:id/pdf", h.PDF)
	api.Post("/:id/void", h.Void)
	api.Get("/:id/lines", h.Lines)
}
