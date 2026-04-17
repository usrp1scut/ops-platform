package httpserver

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"ops-platform/internal/aws"
	"ops-platform/internal/awssync"
	"ops-platform/internal/bastionprobe"
	"ops-platform/internal/cmdb"
	"ops-platform/internal/config"
	"ops-platform/internal/hostkey"
	"ops-platform/internal/iam"
	"ops-platform/internal/keypair"
	"ops-platform/internal/sessions"
	"ops-platform/internal/terminal"
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
		s.cfg,
		iamRepo,
		iam.RequirePermission("iam.user", "read"),
		iam.RequirePermission("iam.user", "write"),
	)
	tokenService := iam.NewTokenService(s.cfg.MasterKey)
	awsRepo := aws.NewRepository(s.db, s.cfg.MasterKey)
	awsSyncService := awssync.NewService(s.cfg, s.db, awsRepo)
	awsSyncRunner := awssync.NewRunner(awsSyncService)
	awsSyncHandler := newAWSSyncHandler(awsRepo, awsSyncRunner)

	cmdbRepo := cmdb.NewRepository(s.db)
	hostkeyRepo := hostkey.NewRepository(s.db)
	hostkeyVerifier := hostkey.NewVerifier(hostkeyRepo)
	hostkeyHandler := hostkey.NewHandler(
		hostkeyRepo,
		iam.RequirePermission("cmdb.asset", "read"),
		iam.RequirePermission("cmdb.asset", "write"),
	)
	sessionsRepo := sessions.NewRepository(s.db)
	sessionsHandler := sessions.NewHandler(sessionsRepo, iam.RequirePermission("cmdb.asset", "read"))
	keypairRepo := keypair.NewRepository(s.db, s.cfg.MasterKey)
	keypairHandler := keypair.NewHandler(
		keypairRepo,
		iam.RequirePermission("cmdb.asset", "read"),
		iam.RequirePermission("cmdb.asset", "write"),
	)
	bastionService := bastionprobe.NewService(s.cfg, cmdbRepo, hostkeyVerifier, keypairRepo)
	cmdbHandler := cmdb.NewHandler(
		s.cfg.MasterKey,
		cmdbRepo,
		bastionService,
		iam.RequirePermission("cmdb.asset", "read"),
		iam.RequirePermission("cmdb.asset", "write"),
	)
	cmdbProxyHandler := cmdb.NewProxyHandler(
		s.cfg.MasterKey,
		cmdbRepo,
		iam.RequirePermission("cmdb.asset", "read"),
		iam.RequirePermission("cmdb.asset", "write"),
	)
	terminalSvc := terminal.NewService()
	terminalHandler := terminal.NewHandler(terminalSvc, bastionService, sessionsRepo, cmdbRepo)
	awsHandler := aws.NewHandler(
		awsRepo,
		iam.RequirePermission("aws.account", "read"),
		iam.RequirePermission("aws.account", "write"),
	)

	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.db.PingContext(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "error", "error": "database unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	router.Route("/auth", func(r chi.Router) {
		r.Mount("/", iamHandler.Routes())
	})

	router.Route("/api/v1", func(r chi.Router) {
		r.Use(iam.AuthMiddleware(tokenService, iamRepo))
		r.Use(iam.AuditMiddleware(iamRepo))
		r.Mount("/cmdb/assets", cmdbHandler.Routes())
		r.Mount("/cmdb/ssh-proxies", cmdbProxyHandler.Routes())
		r.Mount("/cmdb/hostkeys", hostkeyHandler.Routes())
		r.Mount("/cmdb/sessions", sessionsHandler.Routes())
		r.Mount("/ssh-keypairs", keypairHandler.Routes())
		r.With(iam.RequirePermission("cmdb.asset", "write")).
			Post("/cmdb/assets/{assetID}/terminal/ticket", terminalHandler.IssueTicket)
		r.Mount("/aws/accounts", awsHandler.Routes())
		r.With(iam.RequirePermission("aws.account", "read")).Get("/aws/sync/runs", awsSyncHandler.ListRuns)
		r.With(iam.RequirePermission("aws.account", "read")).Get("/aws/sync/status", awsSyncHandler.Status)
		r.With(iam.RequirePermission("aws.account", "write")).Post("/aws/sync/run", awsSyncHandler.Trigger)
		r.Mount("/iam", iamAdminHandler.Routes())
	})

	// WebSocket terminal uses short-lived ticket auth (see terminalHandler.IssueTicket).
	router.Get("/ws/v1/cmdb/assets/{assetID}/terminal", terminalHandler.ServeWS)

	return router
}
