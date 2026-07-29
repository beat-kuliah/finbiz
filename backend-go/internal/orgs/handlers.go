package orgs

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/audit"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
)

// Routes mounts at /api/orgs.
func (s *Service) Routes() chi.Router {
	r := chi.NewRouter()
	r.With(s.auth.RequireAuth).Get("/", s.listOrgs)
	r.With(s.auth.RequireAuth).Post("/", s.createOrg)
	r.With(s.auth.RequireAuth).Post("/invites/accept", s.acceptInvite)
	r.With(s.auth.RequireAuth).Get("/{orgId}/export", s.exportOrg)
	r.With(s.auth.RequireAuth).Get("/{orgId}/members", s.listMembers)
	r.With(s.auth.RequireAuth).Post("/{orgId}/invites", s.createInvite)
	r.With(s.auth.RequireAuth).Delete("/{orgId}/members/{userId}", s.removeMember)
	r.With(s.auth.RequireAuth).Patch("/{orgId}", s.patchOrg)
	r.With(s.auth.RequireAuth).Get("/{orgId}", s.getOrg)
	return r
}

func (s *Service) listOrgs(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	rows, err := s.db.Query(r.Context(), `
		SELECT o.id, o.name, o.slug, o.business_type, m.role, o.created_at
		FROM memberships m
		INNER JOIN organizations o ON m.org_id = o.id
		WHERE m.user_id = $1
		ORDER BY o.created_at
	`, userID)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	defer rows.Close()

	list := []OrgResponse{}
	for rows.Next() {
		var (
			o         OrgResponse
			createdAt time.Time
		)
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.BusinessType, &o.Role, &createdAt); err != nil {
			platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
			return
		}
		o.Currency = "IDR"
		o.CreatedAt = formatCreatedAt(createdAt)
		list = append(list, o)
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"organizations": list,
		"orgs":          list,
	})
}

type createOrgBody struct {
	Name         string   `json:"name"`
	BusinessType string   `json:"businessType"`
	OpeningCash  *float64 `json:"openingCash"`
}

func (s *Service) createOrg(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	var body createOrgBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body"))
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Name is required"))
		return
	}

	bt := normalizeBusinessType(body.BusinessType)
	var opening float64
	if body.OpeningCash != nil && *body.OpeningCash > 0 {
		opening = *body.OpeningCash
	}

	org, openingJournalID, err := s.CreateOrg(r.Context(), userID, body.Name, bt, opening)
	if err != nil {
		if api, ok := err.(*platform.ApiError); ok {
			platform.JSONError(w, api)
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to create organization"))
		return
	}

	platform.JSON(w, http.StatusCreated, map[string]any{
		"organization":     org,
		"org":              org,
		"openingJournalId": openingJournalID,
	})
}

func (s *Service) getOrg(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID := chi.URLParam(r, "orgId")

	var (
		o         OrgResponse
		createdAt time.Time
	)
	err := s.db.QueryRow(r.Context(), `
		SELECT o.id, o.name, o.slug, o.business_type, m.role, o.created_at
		FROM memberships m
		INNER JOIN organizations o ON m.org_id = o.id
		WHERE m.user_id = $1 AND o.id = $2
	`, userID, orgID).Scan(&o.ID, &o.Name, &o.Slug, &o.BusinessType, &o.Role, &createdAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Organization not found"))
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	o.CreatedAt = formatCreatedAt(createdAt)
	platform.JSON(w, http.StatusOK, map[string]any{"org": o})
}

func (s *Service) membershipRole(ctx context.Context, orgID, userID string) (string, error) {
	var role string
	err := s.db.QueryRow(ctx, `
		SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2
	`, orgID, userID).Scan(&role)
	return role, err
}

func isOrgManager(role string) bool {
	return role == "owner" || role == "admin"
}

type patchOrgBody struct {
	Name         *string `json:"name"`
	BusinessType *string `json:"businessType"`
}

func (s *Service) patchOrg(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID := chi.URLParam(r, "orgId")

	role, err := s.membershipRole(r.Context(), orgID, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Organization not found"))
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	if !isOrgManager(role) {
		platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Only owners and admins can update the organization"))
		return
	}

	var body patchOrgBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Name == nil && body.BusinessType == nil) {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "At least one field is required"))
		return
	}

	var curName, curBT string
	err = s.db.QueryRow(r.Context(), `SELECT name, business_type FROM organizations WHERE id = $1`, orgID).
		Scan(&curName, &curBT)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Organization not found"))
		return
	}
	newName, newBT := curName, curBT
	if body.Name != nil {
		newName = strings.TrimSpace(*body.Name)
		if newName == "" {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Name cannot be empty"))
			return
		}
	}
	if body.BusinessType != nil {
		newBT = string(normalizeBusinessType(*body.BusinessType))
	}

	var (
		o         OrgResponse
		createdAt time.Time
	)
	err = s.db.QueryRow(r.Context(), `
		UPDATE organizations SET name = $1, business_type = $2, updated_at = now()
		WHERE id = $3
		RETURNING id, name, slug, business_type, created_at
	`, newName, newBT, orgID).Scan(&o.ID, &o.Name, &o.Slug, &o.BusinessType, &createdAt)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to update organization"))
		return
	}
	o.Role = role
	o.Currency = "IDR"
	o.CreatedAt = formatCreatedAt(createdAt)
	platform.JSON(w, http.StatusOK, map[string]any{"org": o})
}

func (s *Service) listMembers(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID := chi.URLParam(r, "orgId")

	if _, err := s.membershipRole(r.Context(), orgID, userID); err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Organization not found"))
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}

	rows, err := s.db.Query(r.Context(), `
		SELECT m.user_id, u.email, u.name, m.role, m.created_at
		FROM memberships m
		INNER JOIN users u ON u.id = m.user_id
		WHERE m.org_id = $1
		ORDER BY m.created_at
	`, orgID)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	defer rows.Close()

	members := []map[string]any{}
	for rows.Next() {
		var (
			uid, email, name, role string
			createdAt              time.Time
		)
		if err := rows.Scan(&uid, &email, &name, &role, &createdAt); err != nil {
			platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
			return
		}
		members = append(members, map[string]any{
			"userId": uid, "email": email, "name": name, "role": role,
			"createdAt": formatCreatedAt(createdAt),
		})
	}
	platform.JSON(w, http.StatusOK, map[string]any{"members": members})
}

type inviteBody struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (s *Service) createInvite(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID := chi.URLParam(r, "orgId")

	role, err := s.membershipRole(r.Context(), orgID, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Organization not found"))
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	if !isOrgManager(role) {
		platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Only owners and admins can invite members"))
		return
	}

	var body inviteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body"))
		return
	}
	email := strings.TrimSpace(strings.ToLower(body.Email))
	inviteRole := body.Role
	if inviteRole == "" {
		inviteRole = "viewer"
	}
	switch inviteRole {
	case "admin", "accountant", "viewer":
	case "owner":
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Cannot invite as owner"))
		return
	default:
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid role"))
		return
	}
	if email == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Email is required"))
		return
	}

	if err := s.ent.AssertEntitled(r.Context(), userID, "invite_member"); err != nil {
		if api, ok := err.(*platform.ApiError); ok {
			platform.JSONError(w, api)
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Entitlement check failed"))
		return
	}
	if err := s.ent.AssertWithinLimitOrg(r.Context(), userID, "max_seats", orgID); err != nil {
		if api, ok := err.(*platform.ApiError); ok {
			platform.JSONError(w, api)
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Limit check failed"))
		return
	}

	var existingMember string
	err = s.db.QueryRow(r.Context(), `
		SELECT m.id FROM memberships m
		INNER JOIN users u ON u.id = m.user_id
		WHERE m.org_id = $1 AND u.email = $2
	`, orgID, email).Scan(&existingMember)
	if err == nil {
		platform.JSONError(w, platform.NewApiError(http.StatusConflict, "ALREADY_MEMBER", "User is already a member"))
		return
	}
	if err != pgx.ErrNoRows {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}

	token, err := randomSuffix(32)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to create invite"))
		return
	}
	expiresAt := time.Now().UTC().Add(7 * 24 * time.Hour)

	var inviteID string
	err = s.db.QueryRow(r.Context(), `
		INSERT INTO invites (org_id, email, role, token, invited_by, status, expires_at)
		VALUES ($1, $2, $3, $4, $5, 'pending', $6)
		RETURNING id
	`, orgID, email, inviteRole, token, userID, expiresAt).Scan(&inviteID)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to create invite"))
		return
	}

	var orgName string
	_ = s.db.QueryRow(r.Context(), `SELECT name FROM organizations WHERE id = $1`, orgID).Scan(&orgName)

	inviteURL := strings.TrimRight(s.cfgURL, "/") + "/invites/accept?token=" + token
	if s.mailer != nil {
		go func() {
			if err := s.mailer.SendInvite(email, orgName, inviteURL, inviteRole); err != nil {
				// best-effort
				_ = err
			}
		}()
	}

	audit.Log(r.Context(), s.db, orgID, userID, "member.invited", "invite", inviteID, map[string]any{
		"email": email, "role": inviteRole,
	})
	platform.JSON(w, http.StatusCreated, map[string]any{
		"invite": map[string]any{
			"id": inviteID, "email": email, "role": inviteRole,
			"expiresAt": expiresAt.Format(time.RFC3339Nano),
			"token":     token,
		},
	})
}

type acceptInviteBody struct {
	Token string `json:"token"`
}

func (s *Service) acceptInvite(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	var body acceptInviteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Token) == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "token is required"))
		return
	}

	var (
		inviteID, orgID, email, role, status string
		expiresAt                            time.Time
	)
	err := s.db.QueryRow(r.Context(), `
		SELECT id, org_id, email, role::text, status::text, expires_at
		FROM invites WHERE token = $1
	`, body.Token).Scan(&inviteID, &orgID, &email, &role, &status, &expiresAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "INVITE_NOT_FOUND", "Invite not found"))
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	if status != "pending" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "INVITE_INVALID", "Invite is no longer pending"))
		return
	}
	if time.Now().After(expiresAt) {
		_, _ = s.db.Exec(r.Context(), `UPDATE invites SET status = 'expired' WHERE id = $1`, inviteID)
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "INVITE_EXPIRED", "Invite has expired"))
		return
	}

	var userEmail string
	err = s.db.QueryRow(r.Context(), `SELECT email FROM users WHERE id = $1`, userID).Scan(&userEmail)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	if !strings.EqualFold(userEmail, email) {
		platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Invite email does not match your account"))
		return
	}

	var existing string
	err = s.db.QueryRow(r.Context(), `
		SELECT id FROM memberships WHERE org_id = $1 AND user_id = $2
	`, orgID, userID).Scan(&existing)
	if err == nil {
		_, _ = s.db.Exec(r.Context(), `
			UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = $1
		`, inviteID)
		platform.JSON(w, http.StatusOK, map[string]any{"ok": true, "orgId": orgID, "alreadyMember": true})
		return
	}

	_, err = s.db.Exec(r.Context(), `
		INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)
	`, orgID, userID, role)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to join organization"))
		return
	}
	_, _ = s.db.Exec(r.Context(), `
		UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = $1
	`, inviteID)

	platform.JSON(w, http.StatusOK, map[string]any{"ok": true, "orgId": orgID, "role": role})
}

func (s *Service) removeMember(w http.ResponseWriter, r *http.Request) {
	actorID, _ := platform.UserID(r.Context())
	orgID := chi.URLParam(r, "orgId")
	targetID := chi.URLParam(r, "userId")

	actorRole, err := s.membershipRole(r.Context(), orgID, actorID)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Organization not found"))
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	if !isOrgManager(actorRole) {
		platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Only owners and admins can remove members"))
		return
	}

	targetRole, err := s.membershipRole(r.Context(), orgID, targetID)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Member not found"))
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}
	if targetRole == "owner" {
		var ownerCount int
		_ = s.db.QueryRow(r.Context(), `
			SELECT count(*) FROM memberships WHERE org_id = $1 AND role = 'owner'
		`, orgID).Scan(&ownerCount)
		if ownerCount <= 1 {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "LAST_OWNER", "Cannot remove the last owner"))
			return
		}
		if actorRole != "owner" {
			platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Only owners can remove other owners"))
			return
		}
	}

	_, err = s.db.Exec(r.Context(), `
		DELETE FROM memberships WHERE org_id = $1 AND user_id = $2
	`, orgID, targetID)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to remove member"))
		return
	}
	audit.Log(r.Context(), s.db, orgID, actorID, "member.removed", "membership", targetID, map[string]any{
		"role": targetRole,
	})
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) exportOrg(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID := chi.URLParam(r, "orgId")

	var role string
	err := s.db.QueryRow(r.Context(), `
		SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2
	`, orgID, userID).Scan(&role)
	if err != nil || role != "owner" {
		platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Only organization owners can export data"))
		return
	}

	if err := s.ent.AssertEntitled(r.Context(), userID, "export_report"); err != nil {
		if api, ok := err.(*platform.ApiError); ok {
			platform.JSONError(w, api)
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Entitlement check failed"))
		return
	}

	var (
		id, name, slug, bt       string
		createdAt, updatedAt     time.Time
	)
	err = s.db.QueryRow(r.Context(), `
		SELECT id, name, slug, business_type, created_at, updated_at FROM organizations WHERE id = $1
	`, orgID).Scan(&id, &name, &slug, &bt, &createdAt, &updatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "NOT_FOUND", "Organization not found"))
			return
		}
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}

	accounts, err := s.fetchAccounts(r, orgID)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to load accounts"))
		return
	}
	documents, err := s.fetchDocuments(r, orgID)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to load documents"))
		return
	}
	entries, lines, err := s.fetchJournals(r, orgID)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to load journals"))
		return
	}

	platform.JSON(w, http.StatusOK, map[string]any{
		"exportedAt": time.Now().UTC().Format(time.RFC3339Nano),
		"organization": map[string]any{
			"id": id, "name": name, "slug": slug, "businessType": bt,
			"createdAt": formatCreatedAt(createdAt), "updatedAt": formatCreatedAt(updatedAt),
		},
		"accounts":       accounts,
		"documents":      documents,
		"journalEntries": entries,
		"journalLines":   lines,
	})
}

func (s *Service) fetchAccounts(r *http.Request, orgID string) ([]map[string]any, error) {
	rows, err := s.db.Query(r.Context(), `
		SELECT id, org_id, code, name, type, is_cash, is_system, parent_id, created_at
		FROM accounts WHERE org_id = $1 ORDER BY code
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, oid, code, name, typ string
			isCash, isSystem         bool
			parentID                 *string
			createdAt                time.Time
		)
		if err := rows.Scan(&id, &oid, &code, &name, &typ, &isCash, &isSystem, &parentID, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "orgId": oid, "code": code, "name": name, "type": typ,
			"isCash": isCash, "isSystem": isSystem, "parentId": parentID,
			"createdAt": formatCreatedAt(createdAt),
		})
	}
	return out, rows.Err()
}

func (s *Service) fetchDocuments(r *http.Request, orgID string) ([]map[string]any, error) {
	rows, err := s.db.Query(r.Context(), `
		SELECT id, org_id, type, number, contact_id, date::text, due_date::text, status,
			description, total_amount::text, metadata, created_at, updated_at
		FROM documents WHERE org_id = $1
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, oid, typ, number, date, status, total string
			contactID, dueDate, description          *string
			meta                                     []byte
			createdAt, updatedAt                     time.Time
		)
		if err := rows.Scan(&id, &oid, &typ, &number, &contactID, &date, &dueDate, &status,
			&description, &total, &meta, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		var metadata any
		if len(meta) > 0 {
			_ = json.Unmarshal(meta, &metadata)
		}
		out = append(out, map[string]any{
			"id": id, "orgId": oid, "type": typ, "number": number, "contactId": contactID,
			"date": date, "dueDate": dueDate, "status": status, "description": description,
			"totalAmount": total, "metadata": metadata,
			"createdAt": formatCreatedAt(createdAt), "updatedAt": formatCreatedAt(updatedAt),
		})
	}
	return out, rows.Err()
}

func (s *Service) fetchJournals(r *http.Request, orgID string) ([]map[string]any, []map[string]any, error) {
	rows, err := s.db.Query(r.Context(), `
		SELECT id, org_id, document_id, entry_date::text, description, status, posted_at, voided_at, created_by, created_at
		FROM journal_entries WHERE org_id = $1
	`, orgID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	entries := []map[string]any{}
	entryIDs := []string{}
	for rows.Next() {
		var (
			id, oid, entryDate, desc, status string
			documentID, createdBy            *string
			postedAt, voidedAt               *time.Time
			createdAt                        time.Time
		)
		if err := rows.Scan(&id, &oid, &documentID, &entryDate, &desc, &status, &postedAt, &voidedAt, &createdBy, &createdAt); err != nil {
			return nil, nil, err
		}
		entryIDs = append(entryIDs, id)
		var postedS, voidedS *string
		if postedAt != nil {
			s := postedAt.UTC().Format(time.RFC3339Nano)
			postedS = &s
		}
		if voidedAt != nil {
			s := voidedAt.UTC().Format(time.RFC3339Nano)
			voidedS = &s
		}
		entries = append(entries, map[string]any{
			"id": id, "orgId": oid, "documentId": documentID, "entryDate": entryDate,
			"description": desc, "status": status, "postedAt": postedS, "voidedAt": voidedS,
			"createdBy": createdBy, "createdAt": formatCreatedAt(createdAt),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	allLines := []map[string]any{}
	for _, entryID := range entryIDs {
		lrows, err := s.db.Query(r.Context(), `
			SELECT id, entry_id, account_id, debit::text, credit::text, description, line_order
			FROM journal_lines WHERE entry_id = $1 ORDER BY line_order
		`, entryID)
		if err != nil {
			return nil, nil, err
		}
		for lrows.Next() {
			var (
				id, eid, aid, debit, credit string
				description                 *string
				lineOrder                   int
			)
			if err := lrows.Scan(&id, &eid, &aid, &debit, &credit, &description, &lineOrder); err != nil {
				lrows.Close()
				return nil, nil, err
			}
			allLines = append(allLines, map[string]any{
				"id": id, "entryId": eid, "accountId": aid,
				"debit": debit, "credit": credit, "description": description, "lineOrder": lineOrder,
			})
		}
		lrows.Close()
		if err := lrows.Err(); err != nil {
			return nil, nil, err
		}
	}
	return entries, allLines, nil
}
