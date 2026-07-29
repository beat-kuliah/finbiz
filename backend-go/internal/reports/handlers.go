package reports

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/billing"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes dashboard and report HTTP routes.
type Service struct {
	db   *pgxpool.Pool
	auth *auth.Service
	bill *billing.Service
}

// NewService constructs a reports service.
func NewService(db *pgxpool.Pool, authSvc *auth.Service, bill *billing.Service) *Service {
	return &Service{db: db, auth: authSvc, bill: bill}
}

// DashboardRoutes mounts at /api/dashboard.
func (s *Service) DashboardRoutes() chi.Router {
	r := chi.NewRouter()
	r.With(s.auth.RequireAuth, s.auth.RequireOrg).Get("/", s.handleDashboard)
	r.With(s.auth.RequireAuth).Get("/consolidated", s.handleConsolidated)
	return r
}

// ReportsRoutes mounts at /api/reports.
func (s *Service) ReportsRoutes() chi.Router {
	r := chi.NewRouter()
	r.Use(s.auth.RequireAuth, s.auth.RequireOrg)
	r.Get("/profit-loss", s.handleProfitLoss)
	r.Get("/balance-sheet", s.handleBalanceSheet)
	r.Get("/trial-balance", s.handleTrialBalance)
	r.Get("/cash-flow", s.handleCashFlow)
	r.Get("/aging", s.handleAging)
	return r
}

func parseDateRange(r *http.Request) (from, to string) {
	from = r.URL.Query().Get("from")
	to = r.URL.Query().Get("to")
	if from == "" || to == "" {
		df, dt := defaultPeriod()
		if from == "" {
			from = df
		}
		if to == "" {
			to = dt
		}
	}
	return from, to
}

func writeErr(w http.ResponseWriter, err error) {
	if api, ok := err.(*platform.ApiError); ok {
		platform.JSONError(w, api)
		return
	}
	platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Internal server error"))
}

func (s *Service) handleDashboard(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	metrics, err := GetDashboardMetrics(r.Context(), s.db, orgID, nil)
	if err != nil {
		writeErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, metrics)
}

func (s *Service) handleConsolidated(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	rows, err := s.db.Query(r.Context(), `
		SELECT o.id, o.name, o.slug
		FROM memberships m
		INNER JOIN organizations o ON m.org_id = o.id
		WHERE m.user_id = $1
	`, userID)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer rows.Close()

	type orgMeta struct {
		ID   string
		Name string
		Slug string
	}
	var orgs []orgMeta
	for rows.Next() {
		var o orgMeta
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug); err != nil {
			writeErr(w, err)
			return
		}
		orgs = append(orgs, o)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, err)
		return
	}

	orgMetrics := make([]map[string]any, 0, len(orgs))
	totals := DashboardMetrics{}
	for _, o := range orgs {
		m, err := GetDashboardMetrics(r.Context(), s.db, o.ID, nil)
		if err != nil {
			writeErr(w, err)
			return
		}
		orgMetrics = append(orgMetrics, map[string]any{
			"id": o.ID, "name": o.Name, "slug": o.Slug,
			"cash": m.Cash, "periodRevenue": m.PeriodRevenue, "periodNetIncome": m.PeriodNetIncome,
			"receivables": m.Receivables, "payables": m.Payables, "equity": m.Equity,
		})
		totals.Cash += m.Cash
		totals.PeriodRevenue += m.PeriodRevenue
		totals.PeriodNetIncome += m.PeriodNetIncome
		totals.Receivables += m.Receivables
		totals.Payables += m.Payables
		totals.Equity += m.Equity
	}

	platform.JSON(w, http.StatusOK, map[string]any{
		"organizations": orgMetrics,
		"totals":        totals,
	})
}

func (s *Service) handleProfitLoss(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	from, to := parseDateRange(r)
	breakdown := r.URL.Query().Get("breakdown") == "true"
	result, err := GetProfitLoss(r.Context(), s.db, orgID, from, to, breakdown)
	if err != nil {
		writeErr(w, err)
		return
	}
	result["from"] = from
	result["to"] = to
	platform.JSON(w, http.StatusOK, result)
}

func (s *Service) handleBalanceSheet(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	result, err := GetBalanceSheet(r.Context(), s.db, orgID, r.URL.Query().Get("asOf"))
	if err != nil {
		writeErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}

func (s *Service) handleTrialBalance(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	result, err := GetTrialBalance(r.Context(), s.db, orgID, r.URL.Query().Get("asOf"))
	if err != nil {
		writeErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}

func (s *Service) handleCashFlow(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	from, to := parseDateRange(r)
	result, err := GetCashFlow(r.Context(), s.db, orgID, from, to)
	if err != nil {
		writeErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}

func (s *Service) handleAging(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())
	kind := r.URL.Query().Get("kind")
	if kind == "" {
		kind = "receivable"
	}
	if kind != "receivable" && kind != "payable" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "kind must be receivable or payable"))
		return
	}

	if s.bill != nil {
		if err := s.bill.AssertEntitled(r.Context(), userID, string(billing.ActionExportReport)); err != nil {
			if api, ok := err.(*platform.ApiError); ok && api.Code != "NOT_ENTITLED" {
				platform.JSONError(w, api)
				return
			}
		}
	}

	result, err := GetAgingReport(r.Context(), s.db, orgID, kind)
	if err != nil {
		writeErr(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}
