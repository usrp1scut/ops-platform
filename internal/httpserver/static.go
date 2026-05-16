package httpserver

import "net/http"

// mountRootRoutes registers the only non-API route the binary still owns.
//
// ops-api is now API-only: the React/Vite SPA is built and served entirely by
// the standalone web/ image (nginx), which reverse-proxies /api, /auth,
// /healthz and /ws back here on the same origin. Nothing UI-related is
// embedded in this binary anymore, so a bare hit on "/" gets a small JSON
// signpost instead of a confusing 404 — useful for humans and dumb LB probes
// that GET the root.
func mountRootRoutes(router interface {
	Get(pattern string, handlerFn http.HandlerFunc)
}) {
	router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(`{"service":"ops-api","ui":"served by the web/ image","health":"/healthz"}`))
	})
}
