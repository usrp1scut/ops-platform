package httpserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/go-chi/chi/v5"
)

func TestSPAHandlerServesKnownAsset(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":             {Data: []byte("<html>real index</html>")},
		"assets/index-abc123.js": {Data: []byte("console.log('ok');")},
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/assets/index-abc123.js", nil)

	newSPAHandler(dist).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	body, _ := io.ReadAll(rr.Body)
	if !strings.Contains(string(body), "console.log") {
		t.Fatalf("body = %q, want JS content", body)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") && !strings.HasPrefix(ct, "application/javascript") {
		t.Fatalf("Content-Type = %q, want javascript", ct)
	}
}

func TestSPAHandlerFallsBackToIndexForUnknownPath(t *testing.T) {
	dist := fstest.MapFS{
		"index.html": {Data: []byte("<html>real index</html>")},
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/cmdb", nil)

	newSPAHandler(dist).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if got := rr.Body.String(); !strings.Contains(got, "real index") {
		t.Fatalf("body = %q, want real index html", got)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", ct)
	}
	if cache := rr.Header().Get("Cache-Control"); cache != "no-cache" {
		t.Fatalf("Cache-Control = %q, want no-cache", cache)
	}
}

func TestSPAHandlerFallsBackToPlaceholderWhenWebNotBuilt(t *testing.T) {
	dist := fstest.MapFS{
		"placeholder.html": {Data: []byte("<html>web v2 not built</html>")},
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	newSPAHandler(dist).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if got := rr.Body.String(); !strings.Contains(got, "not built") {
		t.Fatalf("body = %q, want placeholder", got)
	}
}

func TestSPAHandler500sWhenNeitherIndexNorPlaceholderPresent(t *testing.T) {
	dist := fstest.MapFS{}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/anything", nil)

	newSPAHandler(dist).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
}

// mountUIRoutes mounts a small chi router using the real production
// route table so we can exercise the cutover redirects end-to-end.
func mountUIForTest(t *testing.T) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	mountUIRoutes(r)
	return r
}

func TestPortalV2RedirectsToPortalPreservingPathAndQuery(t *testing.T) {
	router := mountUIForTest(t)

	cases := []struct {
		name string
		from string
		want string
	}{
		{"bare alias", "/portal-v2", "/portal/"},
		{"trailing slash", "/portal-v2/", "/portal/"},
		{"deep path", "/portal-v2/cmdb", "/portal/cmdb"},
		{"deep path with query", "/portal-v2/cmdb?tab=connection", "/portal/cmdb?tab=connection"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tc.from, nil)
			router.ServeHTTP(rr, req)
			if rr.Code != http.StatusMovedPermanently {
				t.Fatalf("status = %d, want 301", rr.Code)
			}
			if got := rr.Header().Get("Location"); got != tc.want {
				t.Fatalf("Location = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestPortalLegacyServesClassicShell(t *testing.T) {
	router := mountUIForTest(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/portal-legacy/", nil)
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", ct)
	}
	body := rr.Body.String()
	// The legacy index lives at internal/httpserver/ui/portal/index.html.
	// Sanity check that the file server returned a real HTML document
	// rather than the new SPA placeholder or a directory listing.
	if !strings.Contains(strings.ToLower(body), "<!doctype") && !strings.Contains(strings.ToLower(body), "<html") {
		t.Fatalf("legacy body did not look like html: %q", body[:min(120, len(body))])
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
