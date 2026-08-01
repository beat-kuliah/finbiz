package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/icus/finbiz/backend-go/internal/config"
	"github.com/icus/finbiz/backend-go/internal/mail"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EntitlementAction matches TS entitlement actions.
type EntitlementAction string

const (
	ActionCreateOrg         EntitlementAction = "create_org"
	ActionInviteMember      EntitlementAction = "invite_member"
	ActionPostJournal       EntitlementAction = "post_journal"
	ActionExportReport      EntitlementAction = "export_report"
	ActionManageFixedAssets EntitlementAction = "manage_fixed_assets"
)

// Service provides entitlement checks and billing operations.
type Service struct {
	db     *pgxpool.Pool
	cfg    *config.Config
	mailer *mail.Mailer
}

// NewService constructs a billing service. cfg may be nil for entitlement-only use.
func NewService(db *pgxpool.Pool, cfg *config.Config) *Service {
	return &Service{db: db, cfg: cfg}
}

// SetMailer attaches a mailer for payment result emails.
func (s *Service) SetMailer(m *mail.Mailer) {
	s.mailer = m
}

// UserPlanLimits is the result of GetUserPlanLimits.
type UserPlanLimits struct {
	UserID               string
	PlanCode             string
	MaxOrgs              int
	MaxSeats             int
	Features             map[string]bool
	TrialDays            int
	IsTrialActive        bool
	IsSubscriptionActive bool
	SubscriptionStatus   *string
	TrialEndsAt          *time.Time
}

// GetUserPlanLimits loads the user's plan and subscription state.
func (s *Service) GetUserPlanLimits(ctx context.Context, userID string) (*UserPlanLimits, error) {
	var (
		planCode           string
		subStatus          *string
		trialEndsAt        *time.Time
	)
	err := s.db.QueryRow(ctx, `
		SELECT plan, subscription_status, trial_ends_at
		FROM users WHERE id = $1
	`, userID).Scan(&planCode, &subStatus, &trialEndsAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, platform.NewApiError(http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		}
		return nil, err
	}

	var (
		maxOrgs  int
		maxSeats int
		featuresRaw []byte
	)
	err = s.db.QueryRow(ctx, `
		SELECT max_orgs, max_seats, features
		FROM plan_catalog WHERE code = $1
	`, planCode).Scan(&maxOrgs, &maxSeats, &featuresRaw)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, platform.NewApiError(http.StatusInternalServerError, "PLAN_NOT_FOUND", "Plan not found")
		}
		return nil, err
	}

	features := map[string]bool{}
	if len(featuresRaw) > 0 {
		var raw map[string]any
		if err := json.Unmarshal(featuresRaw, &raw); err == nil {
			for k, v := range raw {
				if b, ok := v.(bool); ok {
					features[k] = b
				}
			}
		}
	}

	trialDays := 90
	var trialRaw []byte
	err = s.db.QueryRow(ctx, `SELECT value FROM app_settings WHERE key = 'trial_days'`).Scan(&trialRaw)
	if err == nil {
		var v any
		if json.Unmarshal(trialRaw, &v) == nil {
			if n, ok := v.(float64); ok {
				trialDays = int(n)
			}
		}
	}

	now := time.Now()
	isTrialActive := planCode == "trial" && trialEndsAt != nil && trialEndsAt.After(now)
	isSubscriptionActive := (subStatus != nil && *subStatus == "active") || isTrialActive

	return &UserPlanLimits{
		UserID:               userID,
		PlanCode:             planCode,
		MaxOrgs:              maxOrgs,
		MaxSeats:             maxSeats,
		Features:             features,
		TrialDays:            trialDays,
		IsTrialActive:        isTrialActive,
		IsSubscriptionActive: isSubscriptionActive,
		SubscriptionStatus:   subStatus,
		TrialEndsAt:          trialEndsAt,
	}, nil
}

// AssertEntitled checks subscription and plan feature entitlements.
func (s *Service) AssertEntitled(ctx context.Context, userID string, action string) error {
	limits, err := s.GetUserPlanLimits(ctx, userID)
	if err != nil {
		return err
	}
	if !limits.IsSubscriptionActive {
		return platform.NewApiError(http.StatusForbidden, "SUBSCRIPTION_INACTIVE", "Subscription or trial has expired")
	}

	switch EntitlementAction(action) {
	case ActionCreateOrg:
		if limits.MaxOrgs <= 0 {
			return platform.NewApiError(http.StatusForbidden, "NOT_ENTITLED", "Plan does not allow organizations")
		}
	case ActionInviteMember, ActionPostJournal:
		// allowed when subscription active
	case ActionExportReport:
		if !limits.Features["exports"] {
			return platform.NewApiError(http.StatusForbidden, "NOT_ENTITLED", "Plan does not include exports")
		}
	case ActionManageFixedAssets:
		if !limits.Features["fixedAssets"] {
			return platform.NewApiError(http.StatusForbidden, "NOT_ENTITLED", "Plan does not include fixed assets")
		}
	default:
		return platform.NewApiError(http.StatusForbidden, "NOT_ENTITLED", "Unknown entitlement action")
	}
	return nil
}

// AssertWithinLimit checks max_orgs / max_seats.
func (s *Service) AssertWithinLimit(ctx context.Context, userID string, limit string) error {
	return s.AssertWithinLimitOrg(ctx, userID, limit, "")
}

// AssertWithinLimitOrg checks a limit, optionally scoped to an org for seats.
func (s *Service) AssertWithinLimitOrg(ctx context.Context, userID, limit, orgID string) error {
	limits, err := s.GetUserPlanLimits(ctx, userID)
	if err != nil {
		return err
	}

	switch limit {
	case "max_orgs":
		var count int
		err := s.db.QueryRow(ctx, `
			SELECT count(*) FROM memberships m
			INNER JOIN organizations o ON m.org_id = o.id
			WHERE m.user_id = $1 AND m.role = 'owner'
		`, userID).Scan(&count)
		if err != nil {
			return err
		}
		if count >= limits.MaxOrgs {
			return platform.NewApiError(http.StatusForbidden, "LIMIT_EXCEEDED",
				fmt.Sprintf("Maximum organizations (%d) reached", limits.MaxOrgs))
		}
	case "max_seats":
		if orgID == "" {
			return nil
		}
		var count int
		err := s.db.QueryRow(ctx, `SELECT count(*) FROM memberships WHERE org_id = $1`, orgID).Scan(&count)
		if err != nil {
			return err
		}
		if count >= limits.MaxSeats {
			return platform.NewApiError(http.StatusForbidden, "LIMIT_EXCEEDED",
				fmt.Sprintf("Maximum seats (%d) reached for this organization", limits.MaxSeats))
		}
	}
	return nil
}

// AssertWritable checks subscription active and membership role is not viewer.
func (s *Service) AssertWritable(ctx context.Context, userID, orgID string) error {
	limits, err := s.GetUserPlanLimits(ctx, userID)
	if err != nil {
		return err
	}
	if !limits.IsSubscriptionActive {
		return platform.NewApiError(http.StatusForbidden, "SUBSCRIPTION_INACTIVE",
			"Subscription or trial has expired — read-only mode")
	}

	var role string
	err = s.db.QueryRow(ctx, `
		SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2
	`, orgID, userID).Scan(&role)
	if err != nil {
		if err == pgx.ErrNoRows {
			return platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Not a member of this organization")
		}
		return err
	}
	if role == "viewer" {
		return platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Viewers cannot modify data")
	}
	return nil
}
