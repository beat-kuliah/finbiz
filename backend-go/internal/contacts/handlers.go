package contacts

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/billing"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes contact HTTP routes.
type Service struct {
	db   *pgxpool.Pool
	auth *auth.Service
	bill *billing.Service
}

// NewService constructs a contacts service.
func NewService(db *pgxpool.Pool, authSvc *auth.Service, bill *billing.Service) *Service {
	return &Service{db: db, auth: authSvc, bill: bill}
}

// Routes mounts at /api/contacts.
func (s *Service) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(s.auth.RequireAuth, s.auth.RequireOrg)
	r.Get("/", s.listContacts)
	r.Post("/", s.createContact)
	r.Get("/{id}", s.getContact)
	r.Patch("/{id}", s.patchContact)
	r.Delete("/{id}", s.deleteContact)
	return r
}

func writeAPIError(w http.ResponseWriter, err error) {
	if api, ok := err.(*platform.ApiError); ok {
		platform.JSONError(w, api)
		return
	}
	platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Internal server error"))
}

var allowedKinds = map[string]struct{}{
	"customer": {},
	"vendor":   {},
	"lender":   {},
	"other":    {},
}

type contactOut struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`
	Email     *string `json:"email"`
	Phone     *string `json:"phone"`
	TaxID     *string `json:"taxId"`
	Address   *string `json:"address"`
	CreatedAt string  `json:"createdAt"`
}

func (s *Service) listContacts(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	rows, err := s.db.Query(r.Context(), `
		SELECT id, name, type, email, phone, tax_id, address, created_at
		FROM contacts WHERE org_id = $1
		ORDER BY name
	`, orgID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()

	list := []contactOut{}
	for rows.Next() {
		var (
			c         contactOut
			createdAt time.Time
		)
		if err := rows.Scan(&c.ID, &c.Name, &c.Kind, &c.Email, &c.Phone, &c.TaxID, &c.Address, &createdAt); err != nil {
			writeAPIError(w, err)
			return
		}
		c.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		list = append(list, c)
	}
	platform.JSON(w, http.StatusOK, map[string]any{"contacts": list})
}

type createContactBody struct {
	Name    string  `json:"name"`
	Kind    string  `json:"kind"`
	Email   *string `json:"email"`
	Phone   *string `json:"phone"`
	TaxID   *string `json:"taxId"`
	Address *string `json:"address"`
}

func (s *Service) createContact(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())

	var body createContactBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body"))
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Name is required"))
		return
	}
	if body.Kind == "" {
		body.Kind = "customer"
	}
	if _, ok := allowedKinds[body.Kind]; !ok {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
			"kind must be customer, vendor, lender, or other"))
		return
	}

	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}

	var (
		c         contactOut
		createdAt time.Time
	)
	err := s.db.QueryRow(r.Context(), `
		INSERT INTO contacts (org_id, name, type, email, phone, tax_id, address)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, name, type, email, phone, tax_id, address, created_at
	`, orgID, body.Name, body.Kind, body.Email, body.Phone, body.TaxID, body.Address,
	).Scan(&c.ID, &c.Name, &c.Kind, &c.Email, &c.Phone, &c.TaxID, &c.Address, &createdAt)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	c.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	platform.JSON(w, http.StatusCreated, map[string]any{"contact": c})
}

func (s *Service) getContact(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	id := chi.URLParam(r, "id")

	var (
		c         contactOut
		createdAt time.Time
	)
	err := s.db.QueryRow(r.Context(), `
		SELECT id, name, type, email, phone, tax_id, address, created_at
		FROM contacts WHERE id = $1 AND org_id = $2
	`, id, orgID).Scan(&c.ID, &c.Name, &c.Kind, &c.Email, &c.Phone, &c.TaxID, &c.Address, &createdAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Contact not found"))
			return
		}
		writeAPIError(w, err)
		return
	}
	c.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	platform.JSON(w, http.StatusOK, map[string]any{"contact": c})
}

type patchContactBody struct {
	Name    *string `json:"name"`
	Kind    *string `json:"kind"`
	Email   *string `json:"email"`
	Phone   *string `json:"phone"`
	TaxID   *string `json:"taxId"`
	Address *string `json:"address"`
}

func (s *Service) patchContact(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())
	id := chi.URLParam(r, "id")

	var body patchContactBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body"))
		return
	}
	if body.Name == nil && body.Kind == nil && body.Email == nil && body.Phone == nil && body.TaxID == nil && body.Address == nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "At least one field is required"))
		return
	}
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}

	var (
		cur       contactOut
		createdAt time.Time
	)
	err := s.db.QueryRow(r.Context(), `
		SELECT id, name, type, email, phone, tax_id, address, created_at
		FROM contacts WHERE id = $1 AND org_id = $2
	`, id, orgID).Scan(&cur.ID, &cur.Name, &cur.Kind, &cur.Email, &cur.Phone, &cur.TaxID, &cur.Address, &createdAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Contact not found"))
			return
		}
		writeAPIError(w, err)
		return
	}

	name, kind := cur.Name, cur.Kind
	email, phone, taxID, address := cur.Email, cur.Phone, cur.TaxID, cur.Address
	if body.Name != nil {
		name = strings.TrimSpace(*body.Name)
		if name == "" {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Name cannot be empty"))
			return
		}
	}
	if body.Kind != nil {
		if _, ok := allowedKinds[*body.Kind]; !ok {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
				"kind must be customer, vendor, lender, or other"))
			return
		}
		kind = *body.Kind
	}
	if body.Email != nil {
		email = body.Email
	}
	if body.Phone != nil {
		phone = body.Phone
	}
	if body.TaxID != nil {
		taxID = body.TaxID
	}
	if body.Address != nil {
		address = body.Address
	}

	var c contactOut
	err = s.db.QueryRow(r.Context(), `
		UPDATE contacts SET name = $1, type = $2, email = $3, phone = $4, tax_id = $5, address = $6
		WHERE id = $7
		RETURNING id, name, type, email, phone, tax_id, address, created_at
	`, name, kind, email, phone, taxID, address, id).Scan(
		&c.ID, &c.Name, &c.Kind, &c.Email, &c.Phone, &c.TaxID, &c.Address, &createdAt,
	)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	c.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	platform.JSON(w, http.StatusOK, map[string]any{"contact": c})
}

func (s *Service) deleteContact(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())
	id := chi.URLParam(r, "id")

	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}

	tag, err := s.db.Exec(r.Context(), `DELETE FROM contacts WHERE id = $1 AND org_id = $2`, id, orgID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Contact not found"))
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
