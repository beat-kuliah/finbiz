package assets

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/audit"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/billing"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes fixed-asset HTTP routes.
type Service struct {
	db   *pgxpool.Pool
	auth *auth.Service
	bill *billing.Service
}

// NewService constructs an assets service.
func NewService(db *pgxpool.Pool, authSvc *auth.Service, bill *billing.Service) *Service {
	return &Service{db: db, auth: authSvc, bill: bill}
}

// Routes mounts at /api/assets.
func (s *Service) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(s.auth.RequireAuth, s.auth.RequireOrg)
	r.Get("/", s.listAssets)
	r.Post("/", s.createAsset)
	r.Post("/depreciate", s.depreciate)
	r.Post("/{id}/dispose", s.disposeAsset)
	return r
}

func writeAPIError(w http.ResponseWriter, err error) {
	if api, ok := err.(*platform.ApiError); ok {
		platform.JSONError(w, api)
		return
	}
	platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Internal server error"))
}

func (s *Service) assertManage(w http.ResponseWriter, r *http.Request) (userID, orgID string, ok bool) {
	userID, _ = platform.UserID(r.Context())
	orgID, _ = platform.OrgID(r.Context())
	if err := s.bill.AssertEntitled(r.Context(), userID, string(billing.ActionManageFixedAssets)); err != nil {
		writeAPIError(w, err)
		return "", "", false
	}
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return "", "", false
	}
	return userID, orgID, true
}

func (s *Service) listAssets(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	assets, err := ListAssets(r.Context(), s.db, orgID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if assets == nil {
		assets = []AssetResult{}
	}
	platform.JSON(w, http.StatusOK, map[string]any{"assets": assets})
}

type createAssetBody struct {
	Name             string   `json:"name"`
	AcquisitionDate  string   `json:"acquisitionDate"`
	AcquisitionCost  float64  `json:"acquisitionCost"`
	SalvageValue     *float64 `json:"salvageValue"`
	UsefulLifeMonths int      `json:"usefulLifeMonths"`
	AccountID        string   `json:"accountId"`
	PayWithCash      *bool    `json:"payWithCash"`
	CashAccountID    string   `json:"cashAccountId"`
	Memo             string   `json:"memo"`
}

func (s *Service) createAsset(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := s.assertManage(w, r)
	if !ok {
		return
	}
	var body createAssetBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
		strings.TrimSpace(body.Name) == "" || body.AcquisitionCost <= 0 || body.UsefulLifeMonths <= 0 {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid asset body"))
		return
	}
	asset, err := CreateAsset(r.Context(), s.db, CreateAssetInput{
		OrgID:            orgID,
		UserID:           userID,
		Name:             strings.TrimSpace(body.Name),
		AcquisitionDate:  body.AcquisitionDate,
		AcquisitionCost:  body.AcquisitionCost,
		SalvageValue:     body.SalvageValue,
		UsefulLifeMonths: body.UsefulLifeMonths,
		AccountID:        body.AccountID,
		PayWithCash:      body.PayWithCash,
		CashAccountID:    body.CashAccountID,
		Memo:             body.Memo,
	})
	if err != nil {
		writeAPIError(w, err)
		return
	}
	audit.Log(r.Context(), s.db, orgID, userID, "asset.created", "fixed_asset", asset.ID, map[string]any{
		"name": asset.Name, "cost": body.AcquisitionCost,
	})
	platform.JSON(w, http.StatusCreated, map[string]any{"asset": asset})
}

type depreciateBody struct {
	PeriodYm string `json:"periodYm"`
}

func (s *Service) depreciate(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := s.assertManage(w, r)
	if !ok {
		return
	}
	var body depreciateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PeriodYm == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "periodYm is required"))
		return
	}
	result, err := RunDepreciation(r.Context(), s.db, orgID, userID, body.PeriodYm)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, result)
}

type disposeBody struct {
	Proceeds *float64 `json:"proceeds"`
	Date     string   `json:"date"`
	Memo     string   `json:"memo"`
}

func (s *Service) disposeAsset(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := s.assertManage(w, r)
	if !ok {
		return
	}
	assetID := chi.URLParam(r, "id")
	var body disposeBody
	_ = json.NewDecoder(r.Body).Decode(&body)

	input := DisposeInput{Date: body.Date, Memo: body.Memo}
	if body.Proceeds != nil {
		input.Proceeds = *body.Proceeds
	}
	result, err := DisposeAsset(r.Context(), s.db, orgID, userID, assetID, input)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	audit.Log(r.Context(), s.db, orgID, userID, "asset.disposed", "fixed_asset", assetID, map[string]any{
		"proceeds": body.Proceeds,
	})
	platform.JSON(w, http.StatusOK, result)
}
