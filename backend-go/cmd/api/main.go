package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/icus/finbiz/backend-go/internal/admin"
	"github.com/icus/finbiz/backend-go/internal/arap"
	"github.com/icus/finbiz/backend-go/internal/assets"
	"github.com/icus/finbiz/backend-go/internal/audit"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/billing"
	"github.com/icus/finbiz/backend-go/internal/config"
	"github.com/icus/finbiz/backend-go/internal/contacts"
	"github.com/icus/finbiz/backend-go/internal/db"
	"github.com/icus/finbiz/backend-go/internal/ledger"
	"github.com/icus/finbiz/backend-go/internal/mail"
	"github.com/icus/finbiz/backend-go/internal/orgs"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/icus/finbiz/backend-go/internal/reports"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg := config.MustLoad()
	ctx := context.Background()

	pool, err := db.Connect(ctx, cfg.DatabaseURL())
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	rdbOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis url: %v", err)
	}
	rdb := redis.NewClient(rdbOpts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis ping: %v", err)
	}
	defer rdb.Close()

	mailer := mail.New(cfg)
	mail.Init(mailer)

	authSvc := auth.NewService(pool, rdb, cfg)
	authSvc.SetMailer(mailer)
	billSvc := billing.NewService(pool, cfg)
	billSvc.SetMailer(mailer)
	billHandlers := billing.NewHandlers(billSvc, authSvc)
	orgSvc := orgs.NewService(pool, authSvc, billSvc)
	orgSvc.SetMailer(mailer, cfg.FrontendURL)
	ledgerSvc := ledger.NewService(pool, authSvc, billSvc)
	contactsSvc := contacts.NewService(pool, authSvc, billSvc)
	arapSvc := arap.NewService(pool, authSvc, billSvc)
	assetsSvc := assets.NewService(pool, authSvc, billSvc)
	reportsSvc := reports.NewService(pool, authSvc, billSvc)
	auditSvc := audit.NewService(pool, authSvc)
	adminSvc := admin.NewService(pool, authSvc, billSvc, mailer)

	r := chi.NewRouter()
	r.Use(platform.CORS(cfg.CORSOrigins))
	r.Use(platform.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)

	api := chi.NewRouter()
	api.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		platform.JSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	api.Mount("/auth", authSvc.Routes())
	api.Mount("/orgs", orgSvc.Routes())
	api.Mount("/accounts", ledgerSvc.AccountsRoutes())
	api.Mount("/contacts", contactsSvc.Routes())
	api.Mount("/documents", ledgerSvc.DocumentsRoutes())
	api.Mount("/journals", ledgerSvc.JournalsRoutes())
	api.Mount("/assets", assetsSvc.Routes())
	arapSvc.Mount(api)
	api.Mount("/dashboard", reportsSvc.DashboardRoutes())
	api.Mount("/reports", reportsSvc.ReportsRoutes())
	api.Mount("/periods", ledgerSvc.PeriodsRoutes())
	api.Mount("/billing", billHandlers.BillingRoutes())
	api.Mount("/license", billHandlers.LicenseRoutes())
	api.Mount("/audit-logs", auditSvc.Routes())
	api.Mount("/platform/auth", authSvc.PlatformAuthRoutes())
	api.Mount("/platform", adminSvc.Routes())

	r.Mount("/api", api)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Route not found"))
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("FinBiz API listening on http://localhost:%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
