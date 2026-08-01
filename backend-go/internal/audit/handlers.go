package audit

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes audit-log HTTP routes.
type Service struct {
	db   *pgxpool.Pool
	auth *auth.Service
}

// NewService constructs an audit service.
func NewService(db *pgxpool.Pool, authSvc *auth.Service) *Service {
	return &Service{db: db, auth: authSvc}
}

// Routes mounts at /api/audit-logs.
func (s *Service) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(s.auth.RequireAuth, s.auth.RequireOrg)
	r.Get("/", s.listAuditLogs)
	return r
}

func writeAPIError(w http.ResponseWriter, err error) {
	if api, ok := err.(*platform.ApiError); ok {
		platform.JSONError(w, api)
		return
	}
	platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Internal server error"))
}

type auditLogOut struct {
	ID         string          `json:"id"`
	Action     string          `json:"action"`
	EntityType string          `json:"entityType"`
	EntityID   *string         `json:"entityId"`
	Metadata   json.RawMessage `json:"metadata"`
	UserID     *string         `json:"userId"`
	CreatedAt  string          `json:"createdAt"`
}

func (s *Service) listAuditLogs(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
				"limit must be a positive integer"))
			return
		}
		if n > 200 {
			n = 200
		}
		limit = n
	}

	rows, err := s.db.Query(r.Context(), `
		SELECT id, action, entity_type, entity_id, metadata, user_id, created_at
		FROM audit_logs
		WHERE org_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, orgID, limit)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()

	logs := []auditLogOut{}
	for rows.Next() {
		var (
			log       auditLogOut
			meta      []byte
			createdAt time.Time
		)
		if err := rows.Scan(&log.ID, &log.Action, &log.EntityType, &log.EntityID, &meta, &log.UserID, &createdAt); err != nil {
			writeAPIError(w, err)
			return
		}
		if len(meta) == 0 {
			log.Metadata = json.RawMessage("null")
		} else {
			log.Metadata = json.RawMessage(meta)
		}
		log.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		logs = append(logs, log)
	}
	platform.JSON(w, http.StatusOK, map[string]any{"logs": logs})
}
