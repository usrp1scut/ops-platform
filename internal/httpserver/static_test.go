package httpserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
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
