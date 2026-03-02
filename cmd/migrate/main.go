package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	dsn := os.Getenv("OPS_DATABASE_URL")
	if dsn == "" {
		log.Fatal("OPS_DATABASE_URL is required")
	}

	migrationDir := os.Getenv("OPS_MIGRATIONS_DIR")
	if migrationDir == "" {
		migrationDir = "migrations"
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("ping db: %v", err)
	}

	files, err := os.ReadDir(migrationDir)
	if err != nil {
		log.Fatalf("read migrations dir: %v", err)
	}

	var names []string
	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".sql") {
			names = append(names, file.Name())
		}
	}
	sort.Strings(names)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		log.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback()

	for _, name := range names {
		path := filepath.Join(migrationDir, name)
		sqlBytes, err := os.ReadFile(path)
		if err != nil {
			log.Fatalf("read migration %s: %v", name, err)
		}
		if _, err := tx.ExecContext(ctx, string(sqlBytes)); err != nil {
			log.Fatalf("exec migration %s: %v", name, err)
		}
		fmt.Printf("applied migration: %s\n", name)
	}

	if err := tx.Commit(); err != nil {
		log.Fatalf("commit tx: %v", err)
	}
}
