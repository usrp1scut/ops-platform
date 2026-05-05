package httpserver

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"

	webv2 "ops-platform/internal/httpserver/ui/v2"
)

//go:embed ui/portal/*
var uiAssets embed.FS

func mountUIRoutes(router interface {
	Get(pattern string, handlerFn http.HandlerFunc)
	Handle(pattern string, handler http.Handler)
}) {
	portalFS, err := fs.Sub(uiAssets, "ui/portal")
	if err != nil {
		log.Fatalf("failed to mount UI assets: %v", err)
	}
	portalFileServer := http.FileServer(http.FS(portalFS))

	router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/portal/", http.StatusFound)
	})
	router.Get("/ui", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/portal/", http.StatusFound)
	})
	router.Get("/portal", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/portal/", http.StatusFound)
	})
	router.Handle("/ui/*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/portal/", http.StatusFound)
	}))
	router.Handle("/portal/*", http.StripPrefix("/portal/", portalFileServer))

	// /portal-v2/ serves the new Vite/React app. It runs alongside the legacy
	// /portal/ during the migration so operators can A/B and roll back without
	// a redeploy. Cutover (PR7) will swap the routes.
	v2FS, err := webv2.FS()
	if err != nil {
		log.Fatalf("failed to mount portal v2 assets: %v", err)
	}
	v2Handler := newSPAHandler(v2FS)
	router.Get("/portal-v2", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/portal-v2/", http.StatusFound)
	})
	router.Handle("/portal-v2/*", http.StripPrefix("/portal-v2", v2Handler))
}

// newSPAHandler serves a single-page application: known files are served by
// http.FileServer (with proper content-type and ETags), and any unknown path
// falls back to index.html so React Router can take over client-side routing.
//
// We can't simply wrap the FS to redirect missing files to /index.html because
// http.FileServer would then issue a 301 from /index.html to /, which would
// strip the original deep-link path before React boots.
//
// When the embed directory has not been populated by a real web build (the
// in-tree placeholder.html stub is the only thing present) we fall back to
// that page so operators see a useful "not built" notice instead of a 500.
func newSPAHandler(distFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(distFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if info, err := fs.Stat(distFS, path); err == nil && !info.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		body, err := readSPAIndex(distFS)
		if err != nil {
			http.Error(w, "portal index missing", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(body)
	})
}

// readSPAIndex returns index.html when the web build is present, falling back
// to placeholder.html when it isn't. The two-tier lookup keeps `go build`
// working without a prior web build and lets the Docker pipeline overlay a
// real index.html without touching the committed stub.
func readSPAIndex(distFS fs.FS) ([]byte, error) {
	if body, err := fs.ReadFile(distFS, "index.html"); err == nil {
		return body, nil
	}
	return fs.ReadFile(distFS, "placeholder.html")
}
