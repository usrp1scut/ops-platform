package httpserver

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"ops-platform/internal/aws"
	"ops-platform/internal/cmdb"
	"ops-platform/internal/config"
)

type Server struct {
	cfg config.Config
	db  *sql.DB
}

func New(cfg config.Config, db *sql.DB) *Server {
	return &Server{cfg: cfg, db: db}
}

func (s *Server) Router() http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)

	cmdbHandler := cmdb.NewHandler(cmdb.NewRepository(s.db))
	awsHandler := aws.NewHandler(aws.NewRepository(s.db, s.cfg.MasterKey))

	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	router.Route("/api/v1", func(r chi.Router) {
		r.Mount("/cmdb/assets", cmdbHandler.Routes())
		r.Mount("/aws/accounts", awsHandler.Routes())
	})

	return router
}
