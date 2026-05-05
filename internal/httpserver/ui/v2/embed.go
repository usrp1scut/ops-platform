// Package webv2 embeds the production build of the Vite/React web/ app so the
// Go binary can serve it at /portal-v2/.
//
// Local development workflow:
//
//	cd web
//	MSYS_NO_PATHCONV=1 VITE_BASE=/portal-v2/ npm run build
//	cp -R dist/. ../internal/httpserver/ui/v2/static/
//	go build ./cmd/ops-api
//
// The committed static/index.html is a stub that points operators at this
// workflow. The repository's root .gitignore ignores dist/ globally, which is
// why the embed directory is named static/ instead.
package webv2

import (
	"embed"
	"io/fs"
)

//go:embed static
var staticFS embed.FS

// FS returns the embedded /portal-v2 filesystem with the static/ prefix
// stripped. The returned FS always contains at least the stub index.html.
func FS() (fs.FS, error) {
	return fs.Sub(staticFS, "static")
}
