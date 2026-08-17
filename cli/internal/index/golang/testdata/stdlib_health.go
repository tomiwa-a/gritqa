package fixtures

import "net/http"

func MountHealth(mux *http.ServeMux) {
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /ready", handleReady)
	mux.HandleFunc("GET /version", handleVersion)
}

// Pre-1.22 registrations carry no verb. They must not be guessed.
func MountLegacy(mux *http.ServeMux) {
	mux.HandleFunc("/legacy/ping", handlePing)
	mux.Handle("/legacy/metrics", metricsHandler())
}
