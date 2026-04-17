package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"ops-platform/internal/bastionprobe"
	"ops-platform/internal/cmdb"
	"ops-platform/internal/config"
	"ops-platform/internal/hostkey"
	"ops-platform/internal/keypair"
	"ops-platform/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := store.NewPostgres(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect postgres: %v", err)
	}
	defer db.Close()

	repo := cmdb.NewRepository(db)
	hostkeyVerifier := hostkey.NewVerifier(hostkey.NewRepository(db))
	keypairRepo := keypair.NewRepository(db, cfg.MasterKey)
	service := bastionprobe.NewService(cfg, repo, hostkeyVerifier, keypairRepo)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-stop
		cancel()
	}()

	log.Printf(
		"bastion-probe started interval=%s timeout=%s run_on_start=%t concurrency=%d batch_size=%d",
		cfg.ProbeInterval,
		cfg.ProbeTimeout,
		cfg.ProbeRunOnStart,
		cfg.ProbeConcurrency,
		cfg.ProbeBatchSize,
	)
	service.RunLoop(ctx)
	log.Printf("bastion-probe stopped")
}
