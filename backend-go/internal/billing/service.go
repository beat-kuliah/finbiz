package billing

import (
	"context"
	"crypto/rand"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
)

// Plan is a plan_catalog row.
type Plan struct {
	Code         string         `json:"code"`
	Name         string         `json:"name"`
	PriceMonthly float64        `json:"priceMonthly"`
	PriceYearly  float64        `json:"priceYearly"`
	MaxOrgs      int            `json:"maxOrgs"`
	MaxSeats     int            `json:"maxSeats"`
	Features     map[string]any `json:"features"`
	Active       bool           `json:"active"`
}

// GetActivePlans returns active plans from the catalog.
func (s *Service) GetActivePlans(ctx context.Context) ([]Plan, error) {
	rows, err := s.db.Query(ctx, `
		SELECT code, name, price_monthly::numeric, price_yearly::numeric,
			max_orgs, max_seats, features, active
		FROM plan_catalog WHERE active = true
		ORDER BY code
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var plans []Plan
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		plans = append(plans, p)
	}
	return plans, rows.Err()
}

type scannable interface {
	Scan(dest ...any) error
}

func scanPlan(row scannable) (Plan, error) {
	var (
		p       Plan
		featRaw []byte
	)
	if err := row.Scan(&p.Code, &p.Name, &p.PriceMonthly, &p.PriceYearly,
		&p.MaxOrgs, &p.MaxSeats, &featRaw, &p.Active); err != nil {
		return p, err
	}
	p.Features = map[string]any{}
	if len(featRaw) > 0 {
		_ = json.Unmarshal(featRaw, &p.Features)
	}
	return p, nil
}

// SubscriptionInfo is returned by GetUserSubscription.
type SubscriptionInfo struct {
	User         map[string]any
	Subscription map[string]any
	Plan         *Plan
}

// GetUserSubscription loads user + latest subscription + plan details.
func (s *Service) GetUserSubscription(ctx context.Context, userID string) (*SubscriptionInfo, error) {
	var (
		planCode           string
		subStatus          *string
		trialEndsAt        *time.Time
	)
	err := s.db.QueryRow(ctx, `
		SELECT plan, subscription_status, trial_ends_at FROM users WHERE id = $1
	`, userID).Scan(&planCode, &subStatus, &trialEndsAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, platform.NewApiError(http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		}
		return nil, err
	}

	var trialStr *string
	if trialEndsAt != nil {
		t := trialEndsAt.UTC().Format(time.RFC3339Nano)
		trialStr = &t
	}

	info := &SubscriptionInfo{
		User: map[string]any{
			"plan":               planCode,
			"subscriptionStatus": subStatus,
			"trialEndsAt":        trialStr,
		},
	}

	var (
		subID, subPlan, subStatusVal string
		periodStart, periodEnd, canceledAt *time.Time
	)
	err = s.db.QueryRow(ctx, `
		SELECT id, plan_code, status, current_period_start, current_period_end, canceled_at
		FROM subscriptions WHERE user_id = $1
		ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&subID, &subPlan, &subStatusVal, &periodStart, &periodEnd, &canceledAt)
	if err == nil {
		info.Subscription = map[string]any{
			"id":                 subID,
			"planCode":           subPlan,
			"status":             subStatusVal,
			"currentPeriodStart": formatTimePtr(periodStart),
			"currentPeriodEnd":   formatTimePtr(periodEnd),
			"canceledAt":         formatTimePtr(canceledAt),
		}
	} else if err != pgx.ErrNoRows {
		return nil, err
	}

	var featRaw []byte
	var plan Plan
	err = s.db.QueryRow(ctx, `
		SELECT code, name, price_monthly::numeric, price_yearly::numeric,
			max_orgs, max_seats, features, active
		FROM plan_catalog WHERE code = $1
	`, planCode).Scan(&plan.Code, &plan.Name, &plan.PriceMonthly, &plan.PriceYearly,
		&plan.MaxOrgs, &plan.MaxSeats, &featRaw, &plan.Active)
	if err == nil {
		plan.Features = map[string]any{}
		_ = json.Unmarshal(featRaw, &plan.Features)
		info.Plan = &plan
	} else if err != pgx.ErrNoRows {
		return nil, err
	}

	return info, nil
}

func formatTimePtr(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339Nano)
}

// GetUsage returns owned org count and seat count across memberships.
func (s *Service) GetUsage(ctx context.Context, userID string) (map[string]any, error) {
	var orgCount int
	err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM memberships m
		INNER JOIN organizations o ON m.org_id = o.id
		WHERE m.user_id = $1 AND m.role = 'owner'
	`, userID).Scan(&orgCount)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(ctx, `SELECT DISTINCT org_id FROM memberships WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	seatCount := 0
	for rows.Next() {
		var orgID string
		if err := rows.Scan(&orgID); err != nil {
			return nil, err
		}
		var n int
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM memberships WHERE org_id = $1`, orgID).Scan(&n); err != nil {
			return nil, err
		}
		seatCount += n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{"orgCount": orgCount, "seatCount": seatCount}, nil
}

// CheckoutInput is the createCheckout payload.
type CheckoutInput struct {
	UserID   string
	PlanCode string
	Interval string // monthly | yearly
}

// CreateCheckout creates a Midtrans Snap checkout session (mock when keys unset).
func (s *Service) CreateCheckout(ctx context.Context, input CheckoutInput) (map[string]any, error) {
	var (
		planName                  string
		priceMonthly, priceYearly float64
		active                    bool
	)
	err := s.db.QueryRow(ctx, `
		SELECT name, price_monthly::numeric, price_yearly::numeric, active
		FROM plan_catalog WHERE code = $1
	`, input.PlanCode).Scan(&planName, &priceMonthly, &priceYearly, &active)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, platform.NewApiError(http.StatusNotFound, "PLAN_NOT_FOUND", "Plan not found or inactive")
		}
		return nil, err
	}
	if !active {
		return nil, platform.NewApiError(http.StatusNotFound, "PLAN_NOT_FOUND", "Plan not found or inactive")
	}

	amount := priceMonthly
	if input.Interval == "yearly" {
		amount = priceYearly
	}
	grossAmount := int64(amount)
	if grossAmount < 1 {
		return nil, platform.NewApiError(http.StatusBadRequest, "INVALID_AMOUNT", "Plan price must be greater than zero")
	}

	orderID := "FIN-" + randomHex(12)

	var subID string
	err = s.db.QueryRow(ctx, `
		SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
	`, input.UserID).Scan(&subID)
	if err == pgx.ErrNoRows {
		err = s.db.QueryRow(ctx, `
			INSERT INTO subscriptions (user_id, plan_code, status)
			VALUES ($1, $2, 'trialing')
			RETURNING id
		`, input.UserID, input.PlanCode).Scan(&subID)
		if err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}

	meta, _ := json.Marshal(map[string]any{
		"orderId":  orderID,
		"planCode": input.PlanCode,
		"planName": planName,
		"interval": input.Interval,
		"status":   "pending",
	})
	_, err = s.db.Exec(ctx, `
		INSERT INTO billing_events (user_id, subscription_id, type, amount, metadata)
		VALUES ($1, $2, 'subscription_created', $3, $4)
	`, input.UserID, subID, fmt.Sprintf("%.2f", amount), meta)
	if err != nil {
		return nil, err
	}

	if s.cfg == nil || s.cfg.MidtransServerKey == "" {
		return map[string]any{
			"snapToken":   "mock",
			"redirectUrl": fmt.Sprintf("https://app.finbiz.local/billing/checkout/mock?orderId=%s", orderID),
			"orderId":     orderID,
			"mock":        true,
		}, nil
	}

	var customerEmail, customerName string
	_ = s.db.QueryRow(ctx, `SELECT email, name FROM users WHERE id = $1`, input.UserID).
		Scan(&customerEmail, &customerName)

	snapToken, redirectURL, err := s.createMidtransSnap(ctx, orderID, grossAmount, planName, customerEmail, customerName)
	if err != nil {
		return nil, platform.NewApiError(http.StatusBadGateway, "MIDTRANS_ERROR", err.Error())
	}
	return map[string]any{
		"snapToken":   snapToken,
		"redirectUrl": redirectURL,
		"orderId":     orderID,
		"mock":        false,
	}, nil
}

func (s *Service) createMidtransSnap(ctx context.Context, orderID string, grossAmount int64, itemName, email, name string) (token, redirect string, err error) {
	base := "https://app.sandbox.midtrans.com"
	if s.cfg.MidtransIsProduction {
		base = "https://app.midtrans.com"
	}

	payload := map[string]any{
		"transaction_details": map[string]any{
			"order_id":     orderID,
			"gross_amount": grossAmount,
		},
		"item_details": []map[string]any{{
			"id":       "plan",
			"price":    grossAmount,
			"quantity": 1,
			"name":     itemName,
		}},
		"customer_details": map[string]any{
			"email":      email,
			"first_name": name,
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/snap/v1/transactions", strings.NewReader(string(body)))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.SetBasicAuth(s.cfg.MidtransServerKey, "")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("midtrans snap status %d: %s", resp.StatusCode, string(raw))
	}

	var out struct {
		Token       string `json:"token"`
		RedirectURL string `json:"redirect_url"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", "", err
	}
	if out.Token == "" {
		return "", "", fmt.Errorf("midtrans snap missing token")
	}
	return out.Token, out.RedirectURL, nil
}

func randomHex(n int) string {
	b := make([]byte, (n+1)/2)
	_, _ = rand.Read(b)
	s := hex.EncodeToString(b)
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (s *Service) verifyMidtransSignature(payload map[string]any) bool {
	if s.cfg == nil || s.cfg.MidtransServerKey == "" {
		return true // mock / unsigned webhooks in dev
	}
	orderID := stringFrom(payload, "order_id", "orderId")
	statusCode := stringFrom(payload, "status_code")
	grossAmount := stringFrom(payload, "gross_amount")
	signature := stringFrom(payload, "signature_key")
	if orderID == "" || statusCode == "" || grossAmount == "" || signature == "" {
		return false
	}
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + s.cfg.MidtransServerKey))
	expected := hex.EncodeToString(sum[:])
	return strings.EqualFold(expected, signature)
}

// HandleMidtransWebhook processes payment webhooks (mock-friendly).
func (s *Service) HandleMidtransWebhook(ctx context.Context, payload map[string]any) (map[string]any, error) {
	if !s.verifyMidtransSignature(payload) {
		return nil, platform.NewApiError(http.StatusForbidden, "INVALID_SIGNATURE", "Invalid Midtrans signature")
	}

	orderID := stringFrom(payload, "order_id", "orderId")
	status := strings.ToLower(stringFrom(payload, "transaction_status", "status"))
	fraudStatus := strings.ToLower(stringFrom(payload, "fraud_status"))
	if fraudStatus == "" {
		fraudStatus = "accept"
	}
	if orderID == "" {
		return nil, platform.NewApiError(http.StatusBadRequest, "INVALID_WEBHOOK", "Missing order id")
	}

	success := status == "capture" || status == "settlement" || status == "success" ||
		(status == "accept" && fraudStatus == "accept")

	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, subscription_id, amount, metadata
		FROM billing_events
		ORDER BY created_at DESC LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var (
		userID  string
		subID   *string
		amount  *float64
		metaRaw []byte
		matched bool
	)
	for rows.Next() {
		var (
			id, uid string
			sid     *string
			amt     *float64
			meta    []byte
		)
		if err := rows.Scan(&id, &uid, &sid, &amt, &meta); err != nil {
			return nil, err
		}
		var m map[string]any
		_ = json.Unmarshal(meta, &m)
		if oid, _ := m["orderId"].(string); oid == orderID {
			userID, subID, amount, metaRaw = uid, sid, amt, meta
			matched = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !matched {
		return map[string]any{"ok": true, "matched": false}, nil
	}

	var meta map[string]any
	_ = json.Unmarshal(metaRaw, &meta)
	planName, _ := meta["planName"].(string)
	if planName == "" {
		planName, _ = meta["planCode"].(string)
	}

	if success {
		planCode, _ := meta["planCode"].(string)
		if planCode == "" {
			planCode = "starter"
		}
		_, err = s.db.Exec(ctx, `
			UPDATE users SET plan = $1, subscription_status = 'active' WHERE id = $2
		`, planCode, userID)
		if err != nil {
			return nil, err
		}

		if subID != nil {
			months := 1
			if meta["interval"] == "yearly" {
				months = 12
			}
			periodEnd := time.Now().UTC().AddDate(0, months, 0)
			_, err = s.db.Exec(ctx, `
				UPDATE subscriptions SET plan_code = $1, status = 'active',
					current_period_start = now(), current_period_end = $2, updated_at = now()
				WHERE id = $3
			`, planCode, periodEnd, *subID)
			if err != nil {
				return nil, err
			}
		}

		whMeta, _ := json.Marshal(map[string]any{"orderId": orderID, "webhook": payload})
		_, err = s.db.Exec(ctx, `
			INSERT INTO billing_events (user_id, subscription_id, type, amount, metadata)
			VALUES ($1, $2, 'payment_succeeded', $3, $4)
		`, userID, subID, amount, whMeta)
		if err != nil {
			return nil, err
		}
	} else {
		whMeta, _ := json.Marshal(map[string]any{"orderId": orderID, "webhook": payload})
		_, err = s.db.Exec(ctx, `
			INSERT INTO billing_events (user_id, subscription_id, type, metadata)
			VALUES ($1, $2, 'payment_failed', $3)
		`, userID, subID, whMeta)
		if err != nil {
			return nil, err
		}
	}

	if s.mailer != nil {
		var email string
		if err := s.db.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err == nil && email != "" {
			go func(to string, ok bool, plan string) {
				if err := s.mailer.SendPaymentResult(to, ok, plan); err != nil {
					log.Printf("billing: payment email to %s: %v", to, err)
				}
			}(email, success, planName)
		}
	}

	return map[string]any{"ok": true, "matched": true, "success": success}, nil
}

func stringFrom(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return fmt.Sprint(v)
		}
	}
	return ""
}

// CancelSubscription cancels the user's latest subscription.
func (s *Service) CancelSubscription(ctx context.Context, userID string) (map[string]any, error) {
	var subID string
	err := s.db.QueryRow(ctx, `
		SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&subID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, platform.NewApiError(http.StatusNotFound, "SUBSCRIPTION_NOT_FOUND", "No subscription found")
		}
		return nil, err
	}

	_, err = s.db.Exec(ctx, `
		UPDATE subscriptions SET status = 'canceled', canceled_at = now(), updated_at = now() WHERE id = $1
	`, subID)
	if err != nil {
		return nil, err
	}
	_, err = s.db.Exec(ctx, `UPDATE users SET subscription_status = 'canceled' WHERE id = $1`, userID)
	if err != nil {
		return nil, err
	}
	_, err = s.db.Exec(ctx, `
		INSERT INTO billing_events (user_id, subscription_id, type) VALUES ($1, $2, 'subscription_canceled')
	`, userID, subID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

// ChangePlan updates the user's plan (and subscription if present).
func (s *Service) ChangePlan(ctx context.Context, userID, planCode string) (map[string]any, error) {
	var active bool
	err := s.db.QueryRow(ctx, `SELECT active FROM plan_catalog WHERE code = $1`, planCode).Scan(&active)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, platform.NewApiError(http.StatusNotFound, "PLAN_NOT_FOUND", "Plan not found")
		}
		return nil, err
	}
	if !active {
		return nil, platform.NewApiError(http.StatusNotFound, "PLAN_NOT_FOUND", "Plan not found")
	}

	_, err = s.db.Exec(ctx, `UPDATE users SET plan = $1 WHERE id = $2`, planCode, userID)
	if err != nil {
		return nil, err
	}

	var subID string
	err = s.db.QueryRow(ctx, `
		SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&subID)
	if err == nil {
		_, err = s.db.Exec(ctx, `
			UPDATE subscriptions SET plan_code = $1, updated_at = now() WHERE id = $2
		`, planCode, subID)
		if err != nil {
			return nil, err
		}
	} else if err != pgx.ErrNoRows {
		return nil, err
	}

	return map[string]any{"ok": true, "planCode": planCode}, nil
}

// ListInvoices returns recent billing events as invoices.
func (s *Service) ListInvoices(ctx context.Context, userID string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, type, amount, metadata, created_at
		FROM billing_events WHERE user_id = $1
		ORDER BY created_at DESC LIMIT 50
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []map[string]any
	for rows.Next() {
		var (
			id, typ   string
			amount    *float64
			metaRaw   []byte
			createdAt time.Time
		)
		if err := rows.Scan(&id, &typ, &amount, &metaRaw, &createdAt); err != nil {
			return nil, err
		}
		var meta any
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &meta)
		}
		out = append(out, map[string]any{
			"id":        id,
			"type":      typ,
			"amount":    amount,
			"metadata":  meta,
			"createdAt": createdAt.UTC().Format(time.RFC3339Nano),
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, rows.Err()
}
