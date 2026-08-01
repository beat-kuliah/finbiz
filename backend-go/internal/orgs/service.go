package orgs

import (
	"context"
	"crypto/rand"
	"regexp"
	"strings"
	"time"

	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/billing"
	"github.com/icus/finbiz/backend-go/internal/ledger"
	"github.com/icus/finbiz/backend-go/internal/mail"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Entitlements is the entitlement hook used when creating orgs / exporting.
type Entitlements interface {
	AssertEntitled(ctx context.Context, userID, action string) error
	AssertWithinLimit(ctx context.Context, userID, limit string) error
	AssertWithinLimitOrg(ctx context.Context, userID, limit, orgID string) error
}

// Service provides organization routes.
type Service struct {
	db     *pgxpool.Pool
	auth   *auth.Service
	ent    Entitlements
	mailer *mail.Mailer
	cfgURL string // frontend base URL for invite links
}

// NewService constructs an orgs service.
// If ent is nil, billing.Service is used.
func NewService(db *pgxpool.Pool, authSvc *auth.Service, ent Entitlements) *Service {
	if ent == nil {
		ent = billing.NewService(db, nil)
	}
	return &Service{db: db, auth: authSvc, ent: ent}
}

// SetMailer attaches mailer + frontend URL for invite emails.
func (s *Service) SetMailer(m *mail.Mailer, frontendURL string) {
	s.mailer = m
	s.cfgURL = frontendURL
}

// OrgResponse is the organization API shape.
type OrgResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	BusinessType string `json:"businessType"`
	Currency     string `json:"currency,omitempty"`
	Role         string `json:"role"`
	CreatedAt    string `json:"createdAt"`
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	base := strings.ToLower(name)
	base = nonSlug.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if len(base) > 40 {
		base = base[:40]
	}
	suffix, _ := randomSuffix(6)
	if base == "" {
		base = "org"
	}
	return base + "-" + suffix
}

const suffixAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"

func randomSuffix(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "xxxxxx", err
	}
	out := make([]byte, n)
	for i := range b {
		out[i] = suffixAlphabet[int(b[i])%len(suffixAlphabet)]
	}
	return string(out), nil
}

func normalizeBusinessType(v string) BusinessType {
	switch v {
	case "dagang", "retail":
		return BusinessRetail
	case "jasa", "service":
		return BusinessService
	default:
		return BusinessUMKM
	}
}

func formatCreatedAt(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

// CreateOrg creates an organization with COA and optional opening cash journal.
func (s *Service) CreateOrg(ctx context.Context, userID, name string, businessType BusinessType, openingCash float64) (org OrgResponse, openingJournalID *string, err error) {
	if err := s.ent.AssertEntitled(ctx, userID, "create_org"); err != nil {
		return org, nil, err
	}
	if err := s.ent.AssertWithinLimit(ctx, userID, "max_orgs"); err != nil {
		return org, nil, err
	}

	slug := slugify(name)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return org, nil, err
	}
	defer tx.Rollback(ctx)

	var (
		id, orgName, orgSlug, bt string
		createdAt                time.Time
	)
	err = tx.QueryRow(ctx, `
		INSERT INTO organizations (name, slug, business_type)
		VALUES ($1, $2, $3)
		RETURNING id, name, slug, business_type, created_at
	`, name, slug, string(businessType)).Scan(&id, &orgName, &orgSlug, &bt, &createdAt)
	if err != nil {
		return org, nil, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')
	`, id, userID)
	if err != nil {
		return org, nil, err
	}

	codeToID, err := SeedChartOfAccounts(ctx, tx, id, businessType)
	if err != nil {
		return org, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return org, nil, err
	}

	org = OrgResponse{
		ID: id, Name: orgName, Slug: orgSlug, BusinessType: bt,
		Currency: "IDR", Role: "owner", CreatedAt: formatCreatedAt(createdAt),
	}

	if openingCash > 0 {
		kasID, ok1 := GetAccountIDByCode(codeToID, "1100")
		modalID, ok2 := GetAccountIDByCode(codeToID, "3100")
		if ok1 && ok2 {
			entryID, err := ledger.PostJournal(ctx, s.db, ledger.PostJournalInput{
				OrgID:       id,
				Date:        time.Now().UTC(),
				Description: "Saldo awal kas",
				UserID:      &userID,
				Lines: []ledger.JournalLineInput{
					{AccountID: kasID, Debit: openingCash},
					{AccountID: modalID, Credit: openingCash},
				},
			})
			if err == nil {
				openingJournalID = &entryID
			}
		}
	}

	return org, openingJournalID, nil
}
