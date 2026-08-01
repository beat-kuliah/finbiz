package billing

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
)

// Handlers binds HTTP routes; auth is required for most billing endpoints.
type Handlers struct {
	svc  *Service
	auth *auth.Service
}

// NewHandlers constructs billing/license HTTP handlers.
func NewHandlers(svc *Service, authSvc *auth.Service) *Handlers {
	return &Handlers{svc: svc, auth: authSvc}
}

// BillingRoutes mounts at /api/billing.
func (h *Handlers) BillingRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/plans", h.handlePlans)
	r.With(h.auth.RequireAuth).Get("/subscription", h.handleSubscription)
	r.With(h.auth.RequireAuth).Get("/usage", h.handleUsage)
	r.With(h.auth.RequireAuth).Post("/checkout", h.handleCheckout)
	r.Post("/webhook/midtrans", h.handleWebhook)
	r.With(h.auth.RequireAuth).Post("/cancel", h.handleCancel)
	r.With(h.auth.RequireAuth).Post("/change-plan", h.handleChangePlan)
	r.With(h.auth.RequireAuth).Get("/invoices", h.handleInvoices)
	return r
}

// LicenseRoutes mounts at /api/license.
func (h *Handlers) LicenseRoutes() chi.Router {
	r := chi.NewRouter()
	r.With(h.auth.RequireAuth).Post("/activate", h.handleActivateLicense)
	r.With(h.auth.RequireAuth).Get("/status", h.handleLicenseStatus)
	return r
}

func writeBillingErr(w http.ResponseWriter, err error) {
	if api, ok := err.(*platform.ApiError); ok {
		platform.JSONError(w, api)
		return
	}
	platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Internal server error"))
}

func (h *Handlers) handlePlans(w http.ResponseWriter, r *http.Request) {
	plans, err := h.svc.GetActivePlans(r.Context())
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	if plans == nil {
		plans = []Plan{}
	}
	out := make([]map[string]any, 0, len(plans))
	for _, p := range plans {
		out = append(out, map[string]any{
			"code": p.Code, "name": p.Name,
			"priceMonthly": p.PriceMonthly, "priceYearly": p.PriceYearly,
			"maxOrgs": p.MaxOrgs, "maxSeats": p.MaxSeats, "features": p.Features,
		})
	}
	platform.JSON(w, http.StatusOK, map[string]any{"plans": out})
}

func (h *Handlers) handleSubscription(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	info, err := h.svc.GetUserSubscription(r.Context(), userID)
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	resp := map[string]any{
		"plan":               info.User["plan"],
		"subscriptionStatus": info.User["subscriptionStatus"],
		"trialEndsAt":        info.User["trialEndsAt"],
		"subscription":       info.Subscription,
		"planDetails":        nil,
	}
	if info.Plan != nil {
		resp["planDetails"] = map[string]any{
			"code": info.Plan.Code, "name": info.Plan.Name,
			"maxOrgs": info.Plan.MaxOrgs, "maxSeats": info.Plan.MaxSeats,
			"features": info.Plan.Features,
		}
	}
	platform.JSON(w, http.StatusOK, resp)
}

func (h *Handlers) handleUsage(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	usage, err := h.svc.GetUsage(r.Context(), userID)
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, usage)
}

type checkoutBody struct {
	PlanCode string `json:"planCode"`
	Interval string `json:"interval"`
}

func (h *Handlers) handleCheckout(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	var body checkoutBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PlanCode == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid checkout body"))
		return
	}
	if body.Interval != "monthly" && body.Interval != "yearly" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "interval must be monthly or yearly"))
		return
	}
	result, err := h.svc.CreateCheckout(r.Context(), CheckoutInput{
		UserID: userID, PlanCode: body.PlanCode, Interval: body.Interval,
	})
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}

func (h *Handlers) handleWebhook(w http.ResponseWriter, r *http.Request) {
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid webhook body"))
		return
	}
	result, err := h.svc.HandleMidtransWebhook(r.Context(), payload)
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}

func (h *Handlers) handleCancel(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	result, err := h.svc.CancelSubscription(r.Context(), userID)
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}

type changePlanBody struct {
	PlanCode string `json:"planCode"`
}

func (h *Handlers) handleChangePlan(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	var body changePlanBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PlanCode == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "planCode is required"))
		return
	}
	result, err := h.svc.ChangePlan(r.Context(), userID, body.PlanCode)
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}

func (h *Handlers) handleInvoices(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	invoices, err := h.svc.ListInvoices(r.Context(), userID)
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"invoices": invoices})
}

type activateLicenseBody struct {
	Key string `json:"key"`
}

func (h *Handlers) handleActivateLicense(w http.ResponseWriter, r *http.Request) {
	if !h.svc.IsLicenseFeatureEnabled() {
		platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "LICENSE_DISABLED", "License activation is not enabled"))
		return
	}
	userID, _ := platform.UserID(r.Context())
	var body activateLicenseBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Key == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "key is required"))
		return
	}

	decoded := h.svc.VerifyLicenseKey(body.Key)
	if decoded == nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "INVALID_LICENSE", "Invalid license key"))
		return
	}
	if decoded.ExpiresAt != nil && *decoded.ExpiresAt != "" {
		exp, err := time.Parse(time.RFC3339, *decoded.ExpiresAt)
		if err == nil && exp.Before(time.Now()) {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "LICENSE_EXPIRED", "License key has expired"))
			return
		}
	}

	var (
		existingID      string
		activatedBy     *string
	)
	err := h.svc.db.QueryRow(r.Context(), `
		SELECT id, activated_by_user_id FROM license_keys WHERE key = $1
	`, body.Key).Scan(&existingID, &activatedBy)
	if err != nil && err != pgx.ErrNoRows {
		writeBillingErr(w, err)
		return
	}

	if err == nil {
		if activatedBy != nil && *activatedBy != userID {
			platform.JSONError(w, platform.NewApiError(http.StatusConflict, "LICENSE_IN_USE", "License key already activated"))
			return
		}
		_, err = h.svc.db.Exec(r.Context(), `
			UPDATE license_keys SET activated_by_user_id = $1, activated_at = now() WHERE id = $2
		`, userID, existingID)
	} else {
		var expires any
		if decoded.ExpiresAt != nil && *decoded.ExpiresAt != "" {
			expires = *decoded.ExpiresAt
		}
		_, err = h.svc.db.Exec(r.Context(), `
			INSERT INTO license_keys (key, plan_code, max_orgs, max_seats, activated_by_user_id, activated_at, expires_at)
			VALUES ($1, $2, $3, $4, $5, now(), $6)
		`, body.Key, decoded.PlanCode, decoded.MaxOrgs, decoded.MaxSeats, userID, expires)
	}
	if err != nil {
		writeBillingErr(w, err)
		return
	}

	_, err = h.svc.db.Exec(r.Context(), `
		UPDATE users SET plan = $1, subscription_status = 'active' WHERE id = $2
	`, decoded.PlanCode, userID)
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true, "plan": decoded.PlanCode})
}

func (h *Handlers) handleLicenseStatus(w http.ResponseWriter, r *http.Request) {
	if !h.svc.IsLicenseFeatureEnabled() {
		platform.JSON(w, http.StatusOK, map[string]any{"enabled": false, "activated": false})
		return
	}
	userID, _ := platform.UserID(r.Context())
	var (
		planCode          string
		maxOrgs, maxSeats int
		expiresAt, activatedAt *time.Time
	)
	err := h.svc.db.QueryRow(r.Context(), `
		SELECT plan_code, max_orgs, max_seats, expires_at, activated_at
		FROM license_keys WHERE activated_by_user_id = $1
		LIMIT 1
	`, userID).Scan(&planCode, &maxOrgs, &maxSeats, &expiresAt, &activatedAt)
	if err == pgx.ErrNoRows {
		platform.JSON(w, http.StatusOK, map[string]any{"enabled": true, "activated": false, "license": nil})
		return
	}
	if err != nil {
		writeBillingErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"enabled":   true,
		"activated": true,
		"license": map[string]any{
			"planCode":    planCode,
			"maxOrgs":     maxOrgs,
			"maxSeats":    maxSeats,
			"expiresAt":   formatTimePtr(expiresAt),
			"activatedAt": formatTimePtr(activatedAt),
		},
	})
}
