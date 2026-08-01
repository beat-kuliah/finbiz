package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	ScopeTenant   = "tenant"
	ScopePlatform = "platform"

	TenantRefreshCookie = "finbiz_refresh"
	AdminRefreshCookie  = "finbiz_admin_refresh"

	AccessTokenTTL = 15 * time.Minute
)

// AccessTokenClaims are JWT claims for access tokens.
type AccessTokenClaims struct {
	Email string `json:"email"`
	Type  string `json:"type"`
	Scope string `json:"scope"`
	jwt.RegisteredClaims
}

// RefreshTokenRecord is stored in Redis.
type RefreshTokenRecord struct {
	UserID string `json:"userId"`
	Scope  string `json:"scope"`
}

func (s *Service) signAccessToken(userID, email, scope string) (string, error) {
	now := time.Now()
	claims := AccessTokenClaims{
		Email: email,
		Type:  "access",
		Scope: scope,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenTTL)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.JWTSecret))
}

func (s *Service) verifyAccessToken(tokenStr string) (*AccessTokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &AccessTokenClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*AccessTokenClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	if claims.Type != "access" {
		return nil, fmt.Errorf("invalid token type")
	}
	if claims.Scope != ScopeTenant && claims.Scope != ScopePlatform {
		return nil, fmt.Errorf("invalid scope")
	}
	return claims, nil
}

func (s *Service) issueRefreshToken(ctx context.Context, userID, scope string) (string, error) {
	tokenID := strings.ReplaceAll(uuid.New().String(), "-", "")
	record := RefreshTokenRecord{UserID: userID, Scope: scope}
	raw, err := json.Marshal(record)
	if err != nil {
		return "", err
	}
	if err := s.rdb.Set(ctx, scopeKey(tokenID, scope), raw, RefreshTTL).Err(); err != nil {
		return "", err
	}
	return tokenID, nil
}

func (s *Service) rotateRefreshToken(ctx context.Context, tokenID, scope string) (userID, newTokenID string, err error) {
	key := scopeKey(tokenID, scope)
	raw, err := s.rdb.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return "", "", fmt.Errorf("refresh token not found")
		}
		return "", "", err
	}
	var record RefreshTokenRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return "", "", err
	}
	_ = s.rdb.Del(ctx, key).Err()
	newTokenID, err = s.issueRefreshToken(ctx, record.UserID, scope)
	if err != nil {
		return "", "", err
	}
	return record.UserID, newTokenID, nil
}

func (s *Service) revokeRefreshToken(ctx context.Context, tokenID, scope string) error {
	return s.rdb.Del(ctx, scopeKey(tokenID, scope)).Err()
}

func (s *Service) setRefreshCookie(w http.ResponseWriter, tokenID, scope string) {
	name := TenantRefreshCookie
	if scope == ScopePlatform {
		name = AdminRefreshCookie
	}
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    tokenID,
		Path:     "/",
		MaxAge:   RefreshTTLSeconds,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Service) clearRefreshCookie(w http.ResponseWriter, scope string) {
	name := TenantRefreshCookie
	if scope == ScopePlatform {
		name = AdminRefreshCookie
	}
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func getRefreshTokenFromCookie(r *http.Request, scope string) string {
	name := TenantRefreshCookie
	if scope == ScopePlatform {
		name = AdminRefreshCookie
	}
	c, err := r.Cookie(name)
	if err != nil || c.Value == "" {
		return ""
	}
	return c.Value
}

func getBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) < 8 || h[:7] != "Bearer " {
		return ""
	}
	return h[7:]
}
