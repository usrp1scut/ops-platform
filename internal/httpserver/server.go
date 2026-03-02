package httpserver

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"ops-platform/internal/aws"
	"ops-platform/internal/cmdb"
	"ops-platform/internal/config"
	"ops-platform/internal/iam"
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
	mountUIRoutes(router)

	iamRepo := iam.NewRepository(s.db)
	iamHandler := iam.NewHandler(s.cfg, iamRepo)
	iamAdminHandler := iam.NewAdminHandler(
		iamRepo,
		iam.RequirePermission("iam.user", "read"),
		iam.RequirePermission("iam.user", "write"),
	)
	tokenService := iam.NewTokenService(s.cfg.MasterKey)

	cmdbHandler := cmdb.NewHandler(
		cmdb.NewRepository(s.db),
		iam.RequirePermission("cmdb.asset", "read"),
		iam.RequirePermission("cmdb.asset", "write"),
	)
	awsHandler := aws.NewHandler(
		aws.NewRepository(s.db, s.cfg.MasterKey),
		iam.RequirePermission("aws.account", "read"),
		iam.RequirePermission("aws.account", "write"),
	)

	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	router.Route("/auth", func(r chi.Router) {
		r.Mount("/", iamHandler.Routes())
	})

	router.Route("/api/v1", func(r chi.Router) {
		r.Use(iam.AuthMiddleware(tokenService, iamRepo))
		r.Use(iam.AuditMiddleware(iamRepo))
		r.Mount("/cmdb/assets", cmdbHandler.Routes())
		r.Mount("/aws/accounts", awsHandler.Routes())
		r.Mount("/iam", iamAdminHandler.Routes())
	})

	return router
}
