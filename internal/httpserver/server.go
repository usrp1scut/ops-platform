package httpserver

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"ops-platform/internal/aws"
	"ops-platform/internal/awssync"
	"ops-platform/internal/bastion"
	"ops-platform/internal/bastionprobe"
	"ops-platform/internal/cmdb"
	"ops-platform/internal/config"
	"ops-platform/internal/connectivity"
	"ops-platform/internal/guacproxy"
	"ops-platform/internal/hostkey"
	"ops-platform/internal/iam"
	"ops-platform/internal/keypair"
	"ops-platform/internal/platform/httpx"
	"ops-platform/internal/sessions"
	"ops-platform/internal/sshproxy"
	"ops-platform/internal/storage"
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

	proxyRepo := sshproxy.NewRepository(s.db)
	cmdbRepo := cmdb.NewRepository(s.db, proxyRepo)
	cmdbVPCProxy := cmdb.NewVPCProxyService(cmdbRepo)
	cmdbAWSWriter := cmdb.NewAWSWriter(cmdbRepo)
	awsSyncService := awssync.NewService(s.cfg, awsRepo, cmdbAWSWriter, cmdbVPCProxy)
	awsSyncRunner := awssync.NewRunner(awsSyncService)
	awsSyncHandler := newAWSSyncHandler(awsRepo, awsSyncRunner)
	hostkeyRepo := hostkey.NewRepository(s.db)
	hostkeyVerifier := hostkey.NewVerifier(hostkeyRepo)
	hostkeyHandler := hostkey.NewHandler(
		hostkeyRepo,
		iam.RequirePermission("cmdb.asset", "read"),
		iam.RequirePermission("cmdb.asset", "write"),
	)
	sessionsRepo := sessions.NewRepository(s.db)
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
		cmdbVPCProxy,
		bastionService,
		iam.RequirePermission("cmdb.asset", "read"),
		iam.RequirePermission("cmdb.asset", "write"),
	)
	proxyHandler := sshproxy.NewHandler(
		s.cfg.MasterKey,
		proxyRepo,
		iam.RequirePermission("cmdb.asset", "read"),
		iam.RequirePermission("cmdb.asset", "write"),
	)
	ticketService := connectivity.NewTicketService(context.Background(), 0)
	terminalSvc := terminal.NewService()
	recordingStorage, recordingErr := storage.NewClient(s.cfg)
	if recordingErr != nil && !errors.Is(recordingErr, storage.ErrNoStorage) {
		log.Printf("session recording disabled: %v", recordingErr)
		recordingStorage = nil
	}
	var sessionsRecordings sessions.RecordingFetcher
	if recordingStorage != nil {
		sessionsRecordings = recordingFetcher{recordingStorage}
	}
	sessionsHandler := sessions.NewHandler(sessionsRepo, sessionsRecordings, iam.RequirePermission("cmdb.asset", "read"))
	terminalHandler := terminal.NewHandler(terminalSvc, ticketService, bastionService, sessionsRepo, cmdbRepo, recordingStorage)
	guacSvc := guacproxy.NewService(s.cfg.GuacdAddr, s.cfg.GuacTunnelHost, bastionService)
	guacHandler := guacproxy.NewHandler(guacSvc, ticketService, cmdbRepo, sessionsRepo)
	awsHandler := aws.NewHandler(
		awsRepo,
		iam.RequirePermission("aws.account", "read"),
		iam.RequirePermission("aws.account", "write"),
	)
	bastionRepo := bastion.NewRepository(s.db)
	bastionHandler := bastion.NewHandler(
		bastionRepo,
		iam.RequirePermission("bastion.grant", "read"),
		iam.RequirePermission("bastion.grant", "write"),
		iam.RequirePermission("bastion.request", "read"),
		iam.RequirePermission("bastion.request", "write"),
	)
	requireGrant := bastion.RequireActiveGrant(bastionRepo, "assetID")

	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.db.PingContext(r.Context()); err != nil {
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "error", "error": "database unavailable"})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	router.Route("/auth", func(r chi.Router) {
		r.Mount("/", iamHandler.Routes())
	})

	router.Route("/api/v1", func(r chi.Router) {
		r.Use(iam.AuthMiddleware(tokenService, iamRepo))
		r.Use(iam.AuditMiddleware(iamRepo))
		r.Mount("/cmdb/assets", cmdbHandler.Routes())
		r.Mount("/cmdb/ssh-proxies", proxyHandler.Routes())
		r.Mount("/cmdb/hostkeys", hostkeyHandler.Routes())
		r.Mount("/cmdb/sessions", sessionsHandler.Routes())
		r.Mount("/ssh-keypairs", keypairHandler.Routes())
		// Connect routes: cmdb.asset:read is the baseline (must be able to
		// see the asset) and the JIT grant gate is the actual authorization.
		// Admins (system:admin) bypass the grant check inside RequireActiveGrant.
		r.With(iam.RequirePermission("cmdb.asset", "read")).With(requireGrant).
			Post("/cmdb/assets/{assetID}/terminal/ticket", terminalHandler.IssueTicket)
		r.With(iam.RequirePermission("cmdb.asset", "read")).With(requireGrant).
			Post("/cmdb/assets/{assetID}/rdp/ticket", guacHandler.IssueTicket)
		r.Mount("/bastion", bastionHandler.Routes())
		r.Mount("/aws/accounts", awsHandler.Routes())
		r.With(iam.RequirePermission("aws.account", "read")).Get("/aws/sync/runs", awsSyncHandler.ListRuns)
		r.With(iam.RequirePermission("aws.account", "read")).Get("/aws/sync/status", awsSyncHandler.Status)
		r.With(iam.RequirePermission("aws.account", "write")).Post("/aws/sync/run", awsSyncHandler.Trigger)
		r.Mount("/iam", iamAdminHandler.Routes())
	})

	// WebSocket terminal uses short-lived ticket auth (see terminalHandler.IssueTicket).
	router.Get("/ws/v1/cmdb/assets/{assetID}/terminal", terminalHandler.ServeWS)
	router.Get("/ws/v1/cmdb/assets/{assetID}/rdp", guacHandler.ServeWS)

	return router
}
