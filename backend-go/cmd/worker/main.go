package main

import (
	"context"
	"log"
	"time"

	"github.com/icus/finbiz/backend-go/internal/config"
	"github.com/icus/finbiz/backend-go/internal/db"
	"github.com/icus/finbiz/backend-go/internal/mail"
)

func main() {
	cfg := config.MustLoad()
	ctx := context.Background()

	pool, err := db.Connect(ctx, cfg.DatabaseURL())
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	mailer := mail.New(cfg)
	mail.Init(mailer)

	run := func() {
		n, err := mail.CheckTrialsAndNotify(ctx, pool)
		if err != nil {
			log.Printf("Trial reminder job failed: %v", err)
			return
		}
		log.Printf("Trial reminder job notified %d users", n)
	}

	run()
	ticker := time.NewTicker(12 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		run()
	}
}
