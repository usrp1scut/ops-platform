package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	awsrepo "ops-platform/internal/aws"
	"ops-platform/internal/awssync"
	"ops-platform/internal/config"
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

	accountRepo := awsrepo.NewRepository(db, cfg.MasterKey)
	service := awssync.NewService(cfg, db, accountRepo)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-stop
		cancel()
	}()

	log.Printf("ops-worker started with interval=%s run_on_start=%t", cfg.SyncInterval.String(), cfg.SyncRunOnStart)
	service.RunLoop(ctx)
	log.Printf("ops-worker stopped")
}
