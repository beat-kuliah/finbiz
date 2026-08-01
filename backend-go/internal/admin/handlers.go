package admin

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/billing"
	"github.com/icus/finbiz/backend-go/internal/mail"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes platform admin routes.
type Service struct {
	db      *pgxpool.Pool
	auth    *auth.Service
	billing *billing.Service
	mailer  *mail.Mailer
}

// NewService constructs a platform admin service.
func NewService(db *pgxpool.Pool, authSvc *auth.Service, bill *billing.Service, mailer *mail.Mailer) *Service {
	return &Service{db: db, auth: authSvc, billing: bill, mailer: mailer}
}

// Routes mounts at /api/platform (all RequirePlatformAdmin).
func (s *Service) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(s.auth.RequirePlatformAdmin)

	r.Get("/overview", s.handleOverview)
	r.Get("/users", s.handleUsers)
	r.Get("/subscriptions", s.handleSubscriptions)
	r.Get("/billing-events", s.handleBillingEvents)
	r.Get("/settings", s.handleGetSettings)
	r.Put("/settings", s.handlePutSettings)
	r.Post("/settings/test-email", s.handleTestEmail)
	r.Get("/plans", s.handleListPlans)
	r.Post("/plans", s.handleCreatePlan)
	r.Get("/plans/{code}", s.handleGetPlan)
	r.Put("/plans/{code}", s.handleUpdatePlan)
	r.Post("/users/{id}/extend-trial", s.handleExtendTrial)
	r.Post("/users/{id}/set-plan", s.handleSetPlan)
	r.Post("/licenses", s.handleCreateLicense)
	return r
}

func writeAdminErr(w http.ResponseWriter, err error) {
	if api, ok := err.(*platform.ApiError); ok {
		platform.JSONError(w, api)
		return
	}
	platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Internal server error"))
}

func (s *Service) handleOverview(w http.ResponseWriter, r *http.Request) {
	var users, subs, events, licenses int
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM users`).Scan(&users)
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM subscriptions`).Scan(&subs)
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM billing_events`).Scan(&events)
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM license_keys`).Scan(&licenses)

	trialDays := 90
	var raw []byte
	if err := s.db.QueryRow(r.Context(), `SELECT value FROM app_settings WHERE key = 'trial_days'`).Scan(&raw); err == nil {
		var v any
		if json.Unmarshal(raw, &v) == nil {
			if n, ok := v.(float64); ok {
				trialDays = int(n)
			}
		}
	}

	platform.JSON(w, http.StatusOK, map[string]any{
		"users": users, "subscriptions": subs,
		"billingEvents": events, "licenses": licenses, "trialDays": trialDays,
	})
}

func (s *Service) handleUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT id, email, name, plan, subscription_status, trial_ends_at, is_platform_admin, created_at
		FROM users ORDER BY created_at DESC LIMIT 200
	`)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	defer rows.Close()

	list := []map[string]any{}
	for rows.Next() {
		var (
			id, email, name, plan string
			subStatus             *string
			trialEnds             *time.Time
			isAdmin               bool
			createdAt             time.Time
		)
		if err := rows.Scan(&id, &email, &name, &plan, &subStatus, &trialEnds, &isAdmin, &createdAt); err != nil {
			writeAdminErr(w, err)
			return
		}
		list = append(list, map[string]any{
			"id": id, "email": email, "name": name, "plan": plan,
			"subscriptionStatus": subStatus,
			"trialEndsAt":        formatTS(trialEnds),
			"isPlatformAdmin":    isAdmin,
			"createdAt":          createdAt.UTC().Format(time.RFC3339Nano),
		})
	}
	platform.JSON(w, http.StatusOK, map[string]any{"users": list})
}

func formatTS(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func (s *Service) handleSubscriptions(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT s.id, s.user_id, s.plan_code, s.status,
			s.current_period_start, s.current_period_end, s.canceled_at, s.created_at,
			u.email, u.name
		FROM subscriptions s
		INNER JOIN users u ON s.user_id = u.id
		ORDER BY s.created_at DESC LIMIT 200
	`)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	defer rows.Close()

	list := []map[string]any{}
	for rows.Next() {
		var (
			id, userID, planCode, status, email, name string
			periodStart, periodEnd, canceledAt        *time.Time
			createdAt                                 time.Time
		)
		if err := rows.Scan(&id, &userID, &planCode, &status, &periodStart, &periodEnd, &canceledAt, &createdAt, &email, &name); err != nil {
			writeAdminErr(w, err)
			return
		}
		list = append(list, map[string]any{
			"id": id, "userId": userID, "userEmail": email, "userName": name,
			"planCode": planCode, "status": status,
			"currentPeriodStart": formatTS(periodStart),
			"currentPeriodEnd":   formatTS(periodEnd),
			"canceledAt":         formatTS(canceledAt),
			"createdAt":          createdAt.UTC().Format(time.RFC3339Nano),
		})
	}
	platform.JSON(w, http.StatusOK, map[string]any{"subscriptions": list})
}

func (s *Service) handleBillingEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT e.id, e.user_id, e.subscription_id, e.type, e.amount, e.metadata, e.created_at, u.email
		FROM billing_events e
		INNER JOIN users u ON e.user_id = u.id
		ORDER BY e.created_at DESC LIMIT 200
	`)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	defer rows.Close()

	list := []map[string]any{}
	for rows.Next() {
		var (
			id, userID, typ, email string
			subID                  *string
			amount                 *float64
			metaRaw                []byte
			createdAt              time.Time
		)
		if err := rows.Scan(&id, &userID, &subID, &typ, &amount, &metaRaw, &createdAt, &email); err != nil {
			writeAdminErr(w, err)
			return
		}
		var meta any
		_ = json.Unmarshal(metaRaw, &meta)
		list = append(list, map[string]any{
			"id": id, "userId": userID, "userEmail": email,
			"subscriptionId": subID, "type": typ, "amount": amount,
			"metadata": meta, "createdAt": createdAt.UTC().Format(time.RFC3339Nano),
		})
	}
	platform.JSON(w, http.StatusOK, map[string]any{"events": list})
}

func (s *Service) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT key, value FROM app_settings`)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	defer rows.Close()

	settings := map[string]any{}
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			writeAdminErr(w, err)
			return
		}
		var v any
		_ = json.Unmarshal(raw, &v)
		settings[key] = v
	}
	platform.JSON(w, http.StatusOK, map[string]any{"settings": settings})
}

type settingsBody struct {
	TrialDays *int `json:"trial_days"`
}

func (s *Service) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var body settingsBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid settings body"))
		return
	}
	if body.TrialDays != nil {
		if *body.TrialDays <= 0 {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "trial_days must be positive"))
			return
		}
		raw, _ := json.Marshal(*body.TrialDays)
		_, err := s.db.Exec(r.Context(), `
			INSERT INTO app_settings (key, value, updated_at) VALUES ('trial_days', $1, now())
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
		`, raw)
		if err != nil {
			writeAdminErr(w, err)
			return
		}
	}

	trialDays := 90
	var raw []byte
	if err := s.db.QueryRow(r.Context(), `SELECT value FROM app_settings WHERE key = 'trial_days'`).Scan(&raw); err == nil {
		var v any
		if json.Unmarshal(raw, &v) == nil {
			if n, ok := v.(float64); ok {
				trialDays = int(n)
			}
		}
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"settings": map[string]any{"trial_days": trialDays},
	})
}

type testEmailBody struct {
	To string `json:"to"`
}

func (s *Service) handleTestEmail(w http.ResponseWriter, r *http.Request) {
	var body testEmailBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !strings.Contains(body.To, "@") {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Valid to email is required"))
		return
	}
	if s.mailer == nil {
		platform.JSONError(w, platform.NewApiError(http.StatusServiceUnavailable, "SMTP_UNAVAILABLE", "Mailer not configured"))
		return
	}
	if err := s.mailer.SendTestEmail(body.To); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadGateway, "EMAIL_FAILED", err.Error()))
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleListPlans(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		SELECT code, name, price_monthly::numeric, price_yearly::numeric,
			max_orgs, max_seats, features, active
		FROM plan_catalog ORDER BY code
	`)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	defer rows.Close()

	list := []map[string]any{}
	for rows.Next() {
		p, err := scanAdminPlan(rows)
		if err != nil {
			writeAdminErr(w, err)
			return
		}
		list = append(list, p)
	}
	platform.JSON(w, http.StatusOK, map[string]any{"plans": list})
}

func scanAdminPlan(row interface{ Scan(...any) error }) (map[string]any, error) {
	var (
		code, name string
		monthly, yearly float64
		maxOrgs, maxSeats int
		featRaw []byte
		active bool
	)
	if err := row.Scan(&code, &name, &monthly, &yearly, &maxOrgs, &maxSeats, &featRaw, &active); err != nil {
		return nil, err
	}
	features := map[string]any{}
	_ = json.Unmarshal(featRaw, &features)
	return map[string]any{
		"code": code, "name": name,
		"priceMonthly": monthly, "priceYearly": yearly,
		"maxOrgs": maxOrgs, "maxSeats": maxSeats,
		"features": features, "active": active,
	}, nil
}

type planBody struct {
	Code         string         `json:"code"`
	Name         string         `json:"name"`
	PriceMonthly float64        `json:"priceMonthly"`
	PriceYearly  float64        `json:"priceYearly"`
	MaxOrgs      int            `json:"maxOrgs"`
	MaxSeats     int            `json:"maxSeats"`
	Features     map[string]any `json:"features"`
	Active       *bool          `json:"active"`
}

func (s *Service) handleGetPlan(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	row := s.db.QueryRow(r.Context(), `
		SELECT code, name, price_monthly::numeric, price_yearly::numeric,
			max_orgs, max_seats, features, active
		FROM plan_catalog WHERE code = $1
	`, code)
	p, err := scanAdminPlan(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "PLAN_NOT_FOUND", "Plan not found"))
			return
		}
		writeAdminErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"plan": p})
}

func (s *Service) handleUpdatePlan(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	var body planBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid plan body"))
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	if body.Features == nil {
		body.Features = map[string]any{}
	}
	feat, _ := json.Marshal(body.Features)
	var (
		outCode, outName string
		monthly, yearly  float64
		maxOrgs, maxSeats int
		featRaw []byte
		outActive bool
	)
	err := s.db.QueryRow(r.Context(), `
		UPDATE plan_catalog SET name = $1, price_monthly = $2, price_yearly = $3,
			max_orgs = $4, max_seats = $5, features = $6, active = $7
		WHERE code = $8
		RETURNING code, name, price_monthly::numeric, price_yearly::numeric, max_orgs, max_seats, features, active
	`, body.Name, body.PriceMonthly, body.PriceYearly, body.MaxOrgs, body.MaxSeats, feat, active, code).
		Scan(&outCode, &outName, &monthly, &yearly, &maxOrgs, &maxSeats, &featRaw, &outActive)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "PLAN_NOT_FOUND", "Plan not found"))
			return
		}
		writeAdminErr(w, err)
		return
	}
	features := map[string]any{}
	_ = json.Unmarshal(featRaw, &features)
	platform.JSON(w, http.StatusOK, map[string]any{"plan": map[string]any{
		"code": outCode, "name": outName,
		"priceMonthly": monthly, "priceYearly": yearly,
		"maxOrgs": maxOrgs, "maxSeats": maxSeats,
		"features": features, "active": outActive,
	}})
}

func (s *Service) handleCreatePlan(w http.ResponseWriter, r *http.Request) {
	var body planBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" || body.Name == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid plan body"))
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	if body.Features == nil {
		body.Features = map[string]any{}
	}
	feat, _ := json.Marshal(body.Features)
	var (
		outCode, outName string
		monthly, yearly  float64
		maxOrgs, maxSeats int
		featRaw []byte
		outActive bool
	)
	err := s.db.QueryRow(r.Context(), `
		INSERT INTO plan_catalog (code, name, price_monthly, price_yearly, max_orgs, max_seats, features, active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING code, name, price_monthly::numeric, price_yearly::numeric, max_orgs, max_seats, features, active
	`, body.Code, body.Name, body.PriceMonthly, body.PriceYearly, body.MaxOrgs, body.MaxSeats, feat, active).
		Scan(&outCode, &outName, &monthly, &yearly, &maxOrgs, &maxSeats, &featRaw, &outActive)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	features := map[string]any{}
	_ = json.Unmarshal(featRaw, &features)
	platform.JSON(w, http.StatusCreated, map[string]any{"plan": map[string]any{
		"code": outCode, "name": outName,
		"priceMonthly": monthly, "priceYearly": yearly,
		"maxOrgs": maxOrgs, "maxSeats": maxSeats,
		"features": features, "active": outActive,
	}})
}

type extendTrialBody struct {
	Days int `json:"days"`
}

func (s *Service) handleExtendTrial(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	var body extendTrialBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Days <= 0 {
		body.Days = 30
	}

	var trialEnds *time.Time
	err := s.db.QueryRow(r.Context(), `SELECT trial_ends_at FROM users WHERE id = $1`, userID).Scan(&trialEnds)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "USER_NOT_FOUND", "User not found"))
			return
		}
		writeAdminErr(w, err)
		return
	}

	base := time.Now()
	if trialEnds != nil && trialEnds.After(base) {
		base = *trialEnds
	}
	newEnd := base.AddDate(0, 0, body.Days)
	_, err = s.db.Exec(r.Context(), `
		UPDATE users SET trial_ends_at = $1, subscription_status = 'trialing', plan = 'trial' WHERE id = $2
	`, newEnd, userID)
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "trialEndsAt": newEnd.UTC().Format(time.RFC3339Nano),
	})
}

type setPlanBody struct {
	PlanCode string `json:"planCode"`
}

func (s *Service) handleSetPlan(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	var body setPlanBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PlanCode == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "planCode is required"))
		return
	}

	var exists bool
	err := s.db.QueryRow(r.Context(), `SELECT true FROM plan_catalog WHERE code = $1`, body.PlanCode).Scan(&exists)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "PLAN_NOT_FOUND", "Plan not found"))
			return
		}
		writeAdminErr(w, err)
		return
	}

	_, err = s.db.Exec(r.Context(), `
		UPDATE users SET plan = $1, subscription_status = 'active' WHERE id = $2
	`, body.PlanCode, userID)
	if err != nil {
		writeAdminErr(w, err)
		return
	}

	var subID string
	err = s.db.QueryRow(r.Context(), `
		SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&subID)
	if err == nil {
		_, err = s.db.Exec(r.Context(), `
			UPDATE subscriptions SET plan_code = $1, status = 'active', updated_at = now() WHERE id = $2
		`, body.PlanCode, subID)
	} else if err == pgx.ErrNoRows {
		_, err = s.db.Exec(r.Context(), `
			INSERT INTO subscriptions (user_id, plan_code, status) VALUES ($1, $2, 'active')
		`, userID, body.PlanCode)
	}
	if err != nil {
		writeAdminErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true, "planCode": body.PlanCode})
}

type createLicenseBody struct {
	Email     *string `json:"email"`
	Tier      string  `json:"tier"`
	Seats     *int    `json:"seats"`
	ExpiresAt *string `json:"expiresAt"`
}

func (s *Service) handleCreateLicense(w http.ResponseWriter, r *http.Request) {
	var body createLicenseBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Tier == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "tier is required"))
		return
	}

	var maxOrgs, maxSeats int
	err := s.db.QueryRow(r.Context(), `
		SELECT max_orgs, max_seats FROM plan_catalog WHERE code = $1
	`, body.Tier).Scan(&maxOrgs, &maxSeats)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "PLAN_NOT_FOUND", "Plan tier not found"))
			return
		}
		writeAdminErr(w, err)
		return
	}
	if body.Seats != nil {
		maxSeats = *body.Seats
	}

	key, err := s.billing.GenerateLicenseKey(body.Tier, maxOrgs, maxSeats, body.ExpiresAt)
	if err != nil {
		writeAdminErr(w, err)
		return
	}

	var expires any
	if body.ExpiresAt != nil && *body.ExpiresAt != "" {
		expires = *body.ExpiresAt
	}
	var (
		id, outKey, planCode string
		outOrgs, outSeats    int
		issuedTo             *string
		expiresAt            *time.Time
	)
	err = s.db.QueryRow(r.Context(), `
		INSERT INTO license_keys (key, plan_code, max_orgs, max_seats, issued_to, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, key, plan_code, max_orgs, max_seats, issued_to, expires_at
	`, key, body.Tier, maxOrgs, maxSeats, body.Email, expires).
		Scan(&id, &outKey, &planCode, &outOrgs, &outSeats, &issuedTo, &expiresAt)
	if err != nil {
		writeAdminErr(w, err)
		return
	}

	platform.JSON(w, http.StatusCreated, map[string]any{
		"license": map[string]any{
			"id": id, "key": outKey, "planCode": planCode,
			"maxOrgs": outOrgs, "maxSeats": outSeats,
			"issuedTo": issuedTo, "expiresAt": formatTS(expiresAt),
		},
	})
}
