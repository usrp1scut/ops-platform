package httpserver

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
)

//go:embed ui/*
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
}
