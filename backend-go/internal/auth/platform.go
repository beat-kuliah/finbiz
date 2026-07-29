package auth

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"golang.org/x/crypto/bcrypt"
)

// PlatformAuthRoutes mounts at /api/platform/auth.
func (s *Service) PlatformAuthRoutes() chi.Router {
	r := chi.NewRouter()
	r.Post("/login", s.handlePlatformLogin)
	r.Post("/refresh", s.handlePlatformRefresh)
	r.Post("/logout", s.handlePlatformLogout)
	r.With(s.RequirePlatformAdmin).Get("/me", s.handlePlatformMe)
	return r
}

func (s *Service) handlePlatformLogin(w http.ResponseWriter, r *http.Request) {
	var body loginBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body"))
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))

	var u userRow
	err := s.db.QueryRow(r.Context(), `
		SELECT id, email, name, password_hash, plan, subscription_status, trial_ends_at, is_platform_admin
		FROM users WHERE email = $1
	`, body.Email).Scan(
		&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.SubscriptionStatus, &u.TrialEndsAt, &u.IsPlatformAdmin,
	)
	if err != nil || u.PasswordHash == nil || !u.IsPlatformAdmin {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid admin credentials"))
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*u.PasswordHash), []byte(body.Password)); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid admin credentials"))
		return
	}
	s.respondWithTokens(w, r, u, ScopePlatform)
}

func (s *Service) handlePlatformRefresh(w http.ResponseWriter, r *http.Request) {
	tokenID := getRefreshTokenFromCookie(r, ScopePlatform)
	if tokenID == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Missing refresh token"))
		return
	}
	userID, newTokenID, err := s.rotateRefreshToken(r.Context(), tokenID, ScopePlatform)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Invalid refresh token"))
		return
	}

	var u userRow
	err = s.db.QueryRow(r.Context(), `
		SELECT id, email, name, password_hash, plan, subscription_status, trial_ends_at, is_platform_admin
		FROM users WHERE id = $1
	`, userID).Scan(
		&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.SubscriptionStatus, &u.TrialEndsAt, &u.IsPlatformAdmin,
	)
	if err != nil || !u.IsPlatformAdmin {
		platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Platform admin access required"))
		return
	}

	accessToken, err := s.signAccessToken(u.ID, u.Email, ScopePlatform)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to issue token"))
		return
	}
	s.setRefreshCookie(w, newTokenID, ScopePlatform)
	platform.JSON(w, http.StatusOK, map[string]any{
		"accessToken": accessToken,
		"user":        toAuthUser(u),
	})
}

func (s *Service) handlePlatformLogout(w http.ResponseWriter, r *http.Request) {
	tokenID := getRefreshTokenFromCookie(r, ScopePlatform)
	if tokenID != "" {
		_ = s.revokeRefreshToken(r.Context(), tokenID, ScopePlatform)
	}
	s.clearRefreshCookie(w, ScopePlatform)
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handlePlatformMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := platform.UserID(r.Context())
	if !ok {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Missing access token"))
		return
	}
	var u userRow
	err := s.db.QueryRow(r.Context(), `
		SELECT id, email, name, password_hash, plan, subscription_status, trial_ends_at, is_platform_admin
		FROM users WHERE id = $1
	`, userID).Scan(
		&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.SubscriptionStatus, &u.TrialEndsAt, &u.IsPlatformAdmin,
	)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "USER_NOT_FOUND", "User not found"))
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"user": toAuthUser(u)})
}
