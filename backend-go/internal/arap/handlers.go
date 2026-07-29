package arap

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/billing"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes ARAP HTTP routes.
type Service struct {
	db   *pgxpool.Pool
	auth *auth.Service
	bill *billing.Service
}

// NewService constructs an ARAP service.
func NewService(db *pgxpool.Pool, authSvc *auth.Service, bill *billing.Service) *Service {
	return &Service{db: db, auth: authSvc, bill: bill}
}

// Routes mounts at /api (NOT /api/arap).
func (s *Service) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(s.auth.RequireAuth, s.auth.RequireOrg)
	r.Get("/open-items", s.listOpenItems)
	r.Post("/invoice", s.createInvoice)
	r.Post("/receipt", s.createReceipt)
	r.Post("/loan-in", s.createLoanIn)
	r.Post("/loan-payment", s.createLoanPayment)
	return r
}

// Mount registers ARAP routes on an existing /api router.
func (s *Service) Mount(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(s.auth.RequireAuth, s.auth.RequireOrg)
		r.Get("/open-items", s.listOpenItems)
		r.Post("/invoice", s.createInvoice)
		r.Post("/receipt", s.createReceipt)
		r.Post("/loan-in", s.createLoanIn)
		r.Post("/loan-payment", s.createLoanPayment)
	})
}

func writeAPIError(w http.ResponseWriter, err error) {
	if api, ok := err.(*platform.ApiError); ok {
		platform.JSONError(w, api)
		return
	}
	platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Internal server error"))
}

func (s *Service) listOpenItems(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	kind := OpenItemKind(r.URL.Query().Get("kind"))
	if kind == "" {
		kind = KindReceivable
	}
	if kind != KindReceivable && kind != KindPayable {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
			"kind must be receivable or payable"))
		return
	}
	items, err := ListOpenItems(r.Context(), s.db, orgID, kind)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if items == nil {
		items = []OpenItemRow{}
	}
	platform.JSON(w, http.StatusOK, map[string]any{"kind": kind, "openItems": items})
}

type arapBody struct {
	Amount        float64 `json:"amount"`
	Memo          string  `json:"memo"`
	Date          string  `json:"date"`
	DueDate       string  `json:"dueDate"`
	ContactID     string  `json:"contactId"`
	CashAccountID string  `json:"cashAccountId"`
	OpenItemID    string  `json:"openItemId"`
	DocumentID    string  `json:"documentId"`
}

func (s *Service) decodeBody(w http.ResponseWriter, r *http.Request) (arapBody, bool) {
	var body arapBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Amount <= 0 {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid document body"))
		return body, false
	}
	return body, true
}

func (s *Service) assertPost(w http.ResponseWriter, r *http.Request) (userID, orgID string, ok bool) {
	userID, _ = platform.UserID(r.Context())
	orgID, _ = platform.OrgID(r.Context())
	if err := s.bill.AssertEntitled(r.Context(), userID, string(billing.ActionPostJournal)); err != nil {
		writeAPIError(w, err)
		return "", "", false
	}
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return "", "", false
	}
	return userID, orgID, true
}

func (s *Service) toInput(userID, orgID string, body arapBody) DocumentInput {
	return DocumentInput{
		OrgID:         orgID,
		UserID:        userID,
		Amount:        body.Amount,
		Memo:          body.Memo,
		Date:          body.Date,
		DueDate:       body.DueDate,
		ContactID:     body.ContactID,
		CashAccountID: body.CashAccountID,
		OpenItemID:    body.OpenItemID,
		DocumentID:    body.DocumentID,
	}
}

func (s *Service) createInvoice(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := s.assertPost(w, r)
	if !ok {
		return
	}
	body, ok := s.decodeBody(w, r)
	if !ok {
		return
	}
	doc, err := CreateInvoice(r.Context(), s.db, s.toInput(userID, orgID, body))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	platform.JSON(w, http.StatusCreated, map[string]any{"document": doc})
}

func (s *Service) createReceipt(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := s.assertPost(w, r)
	if !ok {
		return
	}
	body, ok := s.decodeBody(w, r)
	if !ok {
		return
	}
	if body.OpenItemID == "" && body.DocumentID == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
			"openItemId or documentId is required"))
		return
	}
	doc, err := CreateReceipt(r.Context(), s.db, s.toInput(userID, orgID, body))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	platform.JSON(w, http.StatusCreated, map[string]any{"document": doc})
}

func (s *Service) createLoanIn(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := s.assertPost(w, r)
	if !ok {
		return
	}
	body, ok := s.decodeBody(w, r)
	if !ok {
		return
	}
	doc, err := CreateLoanIn(r.Context(), s.db, s.toInput(userID, orgID, body))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	platform.JSON(w, http.StatusCreated, map[string]any{"document": doc})
}

func (s *Service) createLoanPayment(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := s.assertPost(w, r)
	if !ok {
		return
	}
	body, ok := s.decodeBody(w, r)
	if !ok {
		return
	}
	if body.OpenItemID == "" && body.DocumentID == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
			"openItemId or documentId is required"))
		return
	}
	doc, err := CreateLoanPayment(r.Context(), s.db, s.toInput(userID, orgID, body))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	platform.JSON(w, http.StatusCreated, map[string]any{"document": doc})
}
