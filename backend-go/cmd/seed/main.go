package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/icus/finbiz/backend-go/internal/config"
	"github.com/icus/finbiz/backend-go/internal/db"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	cfg := config.MustLoad()
	ctx := context.Background()

	pool, err := db.Connect(ctx, cfg.DatabaseURL())
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	fmt.Println("Seeding app settings...")
	trialRaw, _ := json.Marshal(90)
	_, err = pool.Exec(ctx, `
		INSERT INTO app_settings (key, value, updated_at) VALUES ('trial_days', $1, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`, trialRaw)
	if err != nil {
		log.Fatalf("seed trial_days: %v", err)
	}

	fmt.Println("Seeding plan catalog...")
	plans := []struct {
		Code         string
		Name         string
		PriceMonthly string
		PriceYearly  string
		MaxOrgs      int
		MaxSeats     int
		Features     map[string]bool
	}{
		{
			Code: "trial", Name: "Trial", PriceMonthly: "0", PriceYearly: "0",
			MaxOrgs: 1, MaxSeats: 2,
			Features: map[string]bool{"reports": true, "multiOrg": false},
		},
		{
			Code: "starter", Name: "Starter", PriceMonthly: "99000", PriceYearly: "990000",
			MaxOrgs: 1, MaxSeats: 3,
			Features: map[string]bool{"reports": true, "multiOrg": false, "exports": true},
		},
		{
			Code: "pro", Name: "Pro", PriceMonthly: "199000", PriceYearly: "1990000",
			MaxOrgs: 3, MaxSeats: 10,
			Features: map[string]bool{"reports": true, "multiOrg": true, "exports": true, "fixedAssets": true},
		},
		{
			Code: "business", Name: "Business", PriceMonthly: "499000", PriceYearly: "4990000",
			MaxOrgs: 10, MaxSeats: 50,
			Features: map[string]bool{
				"reports": true, "multiOrg": true, "exports": true,
				"fixedAssets": true, "apiAccess": true,
			},
		},
	}

	for _, p := range plans {
		feat, _ := json.Marshal(p.Features)
		_, err = pool.Exec(ctx, `
			INSERT INTO plan_catalog (code, name, price_monthly, price_yearly, max_orgs, max_seats, features, active)
			VALUES ($1, $2, $3, $4, $5, $6, $7, true)
			ON CONFLICT (code) DO UPDATE SET
				name = EXCLUDED.name,
				price_monthly = EXCLUDED.price_monthly,
				price_yearly = EXCLUDED.price_yearly,
				max_orgs = EXCLUDED.max_orgs,
				max_seats = EXCLUDED.max_seats,
				features = EXCLUDED.features,
				active = EXCLUDED.active
		`, p.Code, p.Name, p.PriceMonthly, p.PriceYearly, p.MaxOrgs, p.MaxSeats, feat)
		if err != nil {
			log.Fatalf("seed plan %s: %v", p.Code, err)
		}
	}

	fmt.Println("Seeding platform admin...")
	email := cfg.PlatformAdminEmail
	password := cfg.PlatformAdminPassword
	if email == "" {
		email = "admin@finbiz.local"
	}
	if password == "" {
		password = "Admin123"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}
	trialEnds := time.Now().UTC().AddDate(0, 0, 365)

	var existingID string
	err = pool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&existingID)
	if err != nil {
		_, err = pool.Exec(ctx, `
			INSERT INTO users (email, name, password_hash, plan, subscription_status, trial_ends_at, is_platform_admin)
			VALUES ($1, 'Platform Admin', $2, 'business', 'active', $3, true)
		`, email, string(hash), trialEnds)
		if err != nil {
			log.Fatalf("insert admin: %v", err)
		}
	} else {
		_, err = pool.Exec(ctx, `
			UPDATE users SET password_hash = $1, is_platform_admin = true,
				plan = 'business', subscription_status = 'active'
			WHERE email = $2
		`, string(hash), email)
		if err != nil {
			log.Fatalf("update admin: %v", err)
		}
	}

	fmt.Println("Seed complete.")
	os.Exit(0)
}
