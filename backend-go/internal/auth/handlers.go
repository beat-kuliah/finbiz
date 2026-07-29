package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/config"
	"github.com/icus/finbiz/backend-go/internal/mail"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

const passwordResetTTL = time.Hour

// Service provides auth routes and middleware.
type Service struct {
	db     *pgxpool.Pool
	rdb    *redis.Client
	cfg    *config.Config
	mailer *mail.Mailer
}

// NewService constructs an auth Service.
func NewService(db *pgxpool.Pool, rdb *redis.Client, cfg *config.Config) *Service {
	return &Service{db: db, rdb: rdb, cfg: cfg}
}

// SetMailer attaches a mailer for welcome / password-reset emails.
func (s *Service) SetMailer(m *mail.Mailer) {
	s.mailer = m
}

// Routes returns chi routes mounted at /api/auth.
func (s *Service) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/register", s.handleRegister)
	r.Post("/login", s.handleLogin)
	r.Post("/google", s.handleGoogle)
	r.Post("/forgot-password", s.handleForgotPassword)
	r.Post("/reset-password", s.handleResetPassword)
	r.Post("/refresh", s.handleRefresh)
	r.Post("/logout", s.handleLogout)
	r.With(s.RequireAuth).Get("/me", s.handleMe)
	return r
}

// AuthUser is the public user shape returned by auth endpoints.
type AuthUser struct {
	ID                 string  `json:"id"`
	Email              string  `json:"email"`
	Name               string  `json:"name"`
	Plan               string  `json:"plan"`
	SubscriptionStatus *string `json:"subscriptionStatus"`
	TrialEndsAt        *string `json:"trialEndsAt"`
	IsPlatformAdmin    bool    `json:"isPlatformAdmin"`
}

type userRow struct {
	ID                 string
	Email              string
	Name               string
	PasswordHash       *string
	Plan               string
	SubscriptionStatus *string
	TrialEndsAt        *time.Time
	IsPlatformAdmin    bool
}

func toAuthUser(u userRow) AuthUser {
	var trial *string
	if u.TrialEndsAt != nil {
		s := u.TrialEndsAt.UTC().Format(time.RFC3339Nano)
		trial = &s
	}
	return AuthUser{
		ID:                 u.ID,
		Email:              u.Email,
		Name:               u.Name,
		Plan:               u.Plan,
		SubscriptionStatus: u.SubscriptionStatus,
		TrialEndsAt:        trial,
		IsPlatformAdmin:    u.IsPlatformAdmin,
	}
}

type registerBody struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type loginBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Service) handleRegister(w http.ResponseWriter, r *http.Request) {
	var body registerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body"))
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	body.Name = strings.TrimSpace(body.Name)
	if body.Email == "" || body.Name == "" || len(body.Password) < 8 {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid registration fields"))
		return
	}

	ctx := r.Context()
	var existingID string
	err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, body.Email).Scan(&existingID)
	if err == nil {
		platform.JSONError(w, platform.NewApiError(http.StatusConflict, "EMAIL_EXISTS", "Email already registered"))
		return
	}
	if err != pgx.ErrNoRows {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	}

	trialDays, err := s.getTrialDays(ctx)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to load trial settings"))
		return
	}
	trialEndsAt := time.Now().UTC().AddDate(0, 0, trialDays)

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to hash password"))
		return
	}

	var u userRow
	err = s.db.QueryRow(ctx, `
		INSERT INTO users (email, name, password_hash, plan, subscription_status, trial_ends_at)
		VALUES ($1, $2, $3, 'trial', 'trialing', $4)
		RETURNING id, email, name, password_hash, plan, subscription_status, trial_ends_at, is_platform_admin
	`, body.Email, body.Name, string(hash), trialEndsAt).Scan(
		&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.SubscriptionStatus, &u.TrialEndsAt, &u.IsPlatformAdmin,
	)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to create user"))
		return
	}

	if s.mailer != nil {
		go func(to, name string) {
			if err := s.mailer.SendWelcome(to, name); err != nil {
				log.Printf("auth: welcome email to %s: %v", to, err)
			}
		}(u.Email, u.Name)
	}

	s.respondWithTokens(w, r, u, ScopeTenant)
}

type googleBody struct {
	IDToken string `json:"idToken"`
}

func (s *Service) handleGoogle(w http.ResponseWriter, r *http.Request) {
	if s.cfg.GoogleClientID == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusNotImplemented, "NOT_IMPLEMENTED", "Google sign-in is not configured"))
		return
	}
	var body googleBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.IDToken) == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "idToken is required"))
		return
	}

	claims, err := s.verifyGoogleIDToken(r.Context(), body.IDToken)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "INVALID_GOOGLE_TOKEN", "Invalid Google ID token"))
		return
	}

	email := strings.ToLower(strings.TrimSpace(claims.Email))
	name := strings.TrimSpace(claims.Name)
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	sub := claims.Subject

	var u userRow
	err = s.db.QueryRow(r.Context(), `
		SELECT id, email, name, password_hash, plan, subscription_status, trial_ends_at, is_platform_admin
		FROM users WHERE google_sub = $1 OR email = $2
		LIMIT 1
	`, sub, email).Scan(
		&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.SubscriptionStatus, &u.TrialEndsAt, &u.IsPlatformAdmin,
	)
	if err == pgx.ErrNoRows {
		trialDays, _ := s.getTrialDays(r.Context())
		trialEndsAt := time.Now().UTC().AddDate(0, 0, trialDays)
		err = s.db.QueryRow(r.Context(), `
			INSERT INTO users (email, name, google_sub, plan, subscription_status, trial_ends_at)
			VALUES ($1, $2, $3, 'trial', 'trialing', $4)
			RETURNING id, email, name, password_hash, plan, subscription_status, trial_ends_at, is_platform_admin
		`, email, name, sub, trialEndsAt).Scan(
			&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Plan, &u.SubscriptionStatus, &u.TrialEndsAt, &u.IsPlatformAdmin,
		)
		if err != nil {
			platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to create user"))
			return
		}
		if s.mailer != nil {
			go func(to, n string) {
				if err := s.mailer.SendWelcome(to, n); err != nil {
					log.Printf("auth: welcome email to %s: %v", to, err)
				}
			}(u.Email, u.Name)
		}
	} else if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Database error"))
		return
	} else {
		_, _ = s.db.Exec(r.Context(), `
			UPDATE users SET google_sub = COALESCE(google_sub, $1) WHERE id = $2
		`, sub, u.ID)
	}

	s.respondWithTokens(w, r, u, ScopeTenant)
}

type forgotBody struct {
	Email string `json:"email"`
}

func (s *Service) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body forgotBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	email := strings.TrimSpace(strings.ToLower(body.Email))

	// Always 200 to avoid email enumeration.
	defer platform.JSON(w, http.StatusOK, map[string]any{"ok": true})

	if email == "" || s.mailer == nil {
		return
	}

	var userID, name string
	err := s.db.QueryRow(r.Context(), `SELECT id, name FROM users WHERE email = $1`, email).Scan(&userID, &name)
	if err != nil {
		return
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return
	}
	token := hex.EncodeToString(tokenBytes)
	if err := s.rdb.Set(r.Context(), "pwdreset:"+token, userID, passwordResetTTL).Err(); err != nil {
		log.Printf("auth: store reset token: %v", err)
		return
	}

	resetURL := strings.TrimRight(s.cfg.FrontendURL, "/") + "/reset-password?token=" + token
	if err := s.mailer.SendPasswordReset(email, resetURL); err != nil {
		log.Printf("auth: reset email to %s: %v", email, err)
	}
}

type resetBody struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (s *Service) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	var body resetBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" || len(body.Password) < 8 {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
			"token and password (min 8 chars) are required"))
		return
	}

	userID, err := s.rdb.Get(r.Context(), "pwdreset:"+body.Token).Result()
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "INVALID_TOKEN", "Invalid or expired reset token"))
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to hash password"))
		return
	}
	_, err = s.db.Exec(r.Context(), `UPDATE users SET password_hash = $1 WHERE id = $2`, string(hash), userID)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to update password"))
		return
	}
	_ = s.rdb.Del(r.Context(), "pwdreset:"+body.Token).Err()
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleLogin(w http.ResponseWriter, r *http.Request) {
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
	if err != nil || u.PasswordHash == nil {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid email or password"))
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(*u.PasswordHash), []byte(body.Password)) != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid email or password"))
		return
	}

	s.respondWithTokens(w, r, u, ScopeTenant)
}

func (s *Service) handleRefresh(w http.ResponseWriter, r *http.Request) {
	tokenID := getRefreshTokenFromCookie(r, ScopeTenant)
	if tokenID == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Missing refresh token"))
		return
	}

	userID, newTokenID, err := s.rotateRefreshToken(r.Context(), tokenID, ScopeTenant)
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
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "USER_NOT_FOUND", "User not found"))
		return
	}

	accessToken, err := s.signAccessToken(u.ID, u.Email, ScopeTenant)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to issue token"))
		return
	}
	s.setRefreshCookie(w, newTokenID, ScopeTenant)
	platform.JSON(w, http.StatusOK, map[string]any{
		"accessToken": accessToken,
		"user":        toAuthUser(u),
	})
}

func (s *Service) handleLogout(w http.ResponseWriter, r *http.Request) {
	tokenID := getRefreshTokenFromCookie(r, ScopeTenant)
	if tokenID != "" {
		_ = s.revokeRefreshToken(r.Context(), tokenID, ScopeTenant)
	}
	s.clearRefreshCookie(w, ScopeTenant)
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
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

func (s *Service) respondWithTokens(w http.ResponseWriter, r *http.Request, u userRow, scope string) {
	accessToken, err := s.signAccessToken(u.ID, u.Email, scope)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to issue token"))
		return
	}
	refreshID, err := s.issueRefreshToken(r.Context(), u.ID, scope)
	if err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Failed to issue refresh token"))
		return
	}
	s.setRefreshCookie(w, refreshID, scope)
	platform.JSON(w, http.StatusOK, map[string]any{
		"accessToken": accessToken,
		"user":        toAuthUser(u),
	})
}

func (s *Service) getTrialDays(ctx context.Context) (int, error) {
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT value FROM app_settings WHERE key = 'trial_days'`).Scan(&raw)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 90, nil
		}
		return 90, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return 90, nil
	}
	switch n := v.(type) {
	case float64:
		return int(n), nil
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return 90, nil
		}
		return int(i), nil
	default:
		return 90, nil
	}
}

// SignAccessToken is exported for platform auth and other packages.
func (s *Service) SignAccessToken(userID, email, scope string) (string, error) {
	return s.signAccessToken(userID, email, scope)
}

// IssueRefreshToken is exported for platform auth.
func (s *Service) IssueRefreshToken(ctx context.Context, userID, scope string) (string, error) {
	return s.issueRefreshToken(ctx, userID, scope)
}

// RotateRefreshToken is exported for platform auth.
func (s *Service) RotateRefreshToken(ctx context.Context, tokenID, scope string) (userID, newTokenID string, err error) {
	return s.rotateRefreshToken(ctx, tokenID, scope)
}

// RevokeRefreshToken is exported for platform auth.
func (s *Service) RevokeRefreshToken(ctx context.Context, tokenID, scope string) error {
	return s.revokeRefreshToken(ctx, tokenID, scope)
}

// SetRefreshCookie is exported for platform auth.
func (s *Service) SetRefreshCookie(w http.ResponseWriter, tokenID, scope string) {
	s.setRefreshCookie(w, tokenID, scope)
}

// ClearRefreshCookie is exported for platform auth.
func (s *Service) ClearRefreshCookie(w http.ResponseWriter, scope string) {
	s.clearRefreshCookie(w, scope)
}

// GetRefreshTokenFromCookie is exported for platform auth.
func GetRefreshTokenFromCookie(r *http.Request, scope string) string {
	return getRefreshTokenFromCookie(r, scope)
}
