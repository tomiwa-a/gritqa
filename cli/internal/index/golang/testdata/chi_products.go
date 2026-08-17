package fixtures

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type ProductHandler struct{}

func (h *ProductHandler) List(w http.ResponseWriter, r *http.Request)       {}
func (h *ProductHandler) Create(w http.ResponseWriter, r *http.Request)     {}
func (h *ProductHandler) Get(w http.ResponseWriter, r *http.Request)        {}
func (h *ProductHandler) Update(w http.ResponseWriter, r *http.Request)     {}
func (h *ProductHandler) Delete(w http.ResponseWriter, r *http.Request)     {}
func (h *ProductHandler) Prices(w http.ResponseWriter, r *http.Request)     {}
func (h *ProductHandler) AddPrice(w http.ResponseWriter, r *http.Request)   {}
func (h *ProductHandler) Archive(w http.ResponseWriter, r *http.Request)    {}
func (h *ProductHandler) Search(w http.ResponseWriter, r *http.Request)     {}
func (h *ProductHandler) BulkCreate(w http.ResponseWriter, r *http.Request) {}

func MountProducts(r chi.Router, h *ProductHandler) {
	r.Route("/products", func(r chi.Router) {
		r.Use(middleware.Logger)

		r.Get("/", h.List)
		r.Post("/", h.Create)

		r.Route("/{id}", func(r chi.Router) {
			r.Use(RequireAuth)

			r.Get("/", h.Get)
			r.Patch("/", h.Update)
			r.Delete("/", h.Delete)
			r.Get("/prices", h.Prices)
			r.Post("/prices", h.AddPrice)
			r.Post("/archive", h.Archive)
		})

		r.Get("/search", h.Search)
		r.Post("/bulk", h.BulkCreate)
	})
}
