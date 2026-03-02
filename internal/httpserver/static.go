package httpserver

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed ui/*
var uiAssets embed.FS

func mountUIRoutes(router interface {
	Get(pattern string, handlerFn http.HandlerFunc)
	Handle(pattern string, handler http.Handler)
}) {
	subFS, err := fs.Sub(uiAssets, "ui")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(subFS))

	router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ui/", http.StatusFound)
	})
	router.Get("/ui", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ui/", http.StatusFound)
	})
	router.Handle("/ui/*", http.StripPrefix("/ui/", fileServer))
}
