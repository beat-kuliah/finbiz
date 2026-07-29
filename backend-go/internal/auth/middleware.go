package auth

import (
	"net/http"

	"github.com/icus/finbiz/backend-go/internal/platform"
)

// RequireAuth requires a valid tenant-scoped access token.
func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := getBearerToken(r)
		if token == "" {
			platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Missing access token"))
			return
		}
		claims, err := s.verifyAccessToken(token)
		if err != nil || claims.Scope != ScopeTenant {
			platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired access token"))
			return
		}
		ctx := r.Context()
		ctx = platform.WithUserID(ctx, claims.Subject)
		ctx = platform.WithEmail(ctx, claims.Email)
		ctx = platform.WithScope(ctx, claims.Scope)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequirePlatformAdmin requires a platform-scoped token and users.is_platform_admin.
func (s *Service) RequirePlatformAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := getBearerToken(r)
		if token == "" {
			platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Missing access token"))
			return
		}
		claims, err := s.verifyAccessToken(token)
		if err != nil {
			platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired access token"))
			return
		}
		if claims.Scope != ScopePlatform {
			platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Invalid token scope"))
			return
		}

		var isAdmin bool
		err = s.db.QueryRow(r.Context(),
			`SELECT is_platform_admin FROM users WHERE id = $1`, claims.Subject,
		).Scan(&isAdmin)
		if err != nil || !isAdmin {
			platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Platform admin access required"))
			return
		}

		ctx := r.Context()
		ctx = platform.WithUserID(ctx, claims.Subject)
		ctx = platform.WithEmail(ctx, claims.Email)
		ctx = platform.WithScope(ctx, claims.Scope)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireOrg requires X-Organization-Id and membership for the authenticated user.
func (s *Service) RequireOrg(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		orgID := r.Header.Get("X-Organization-Id")
		if orgID == "" {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "ORG_REQUIRED", "X-Organization-Id header is required"))
			return
		}
		userID, ok := platform.UserID(r.Context())
		if !ok {
			platform.JSONError(w, platform.NewApiError(http.StatusUnauthorized, "UNAUTHORIZED", "Missing access token"))
			return
		}

		var role string
		err := s.db.QueryRow(r.Context(),
			`SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
			orgID, userID,
		).Scan(&role)
		if err != nil {
			platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Not a member of this organization"))
			return
		}

		ctx := r.Context()
		ctx = platform.WithOrgID(ctx, orgID)
		ctx = platform.WithOrgRole(ctx, role)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireOrgRole requires the membership role to be one of roles.
func (s *Service) RequireOrgRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, ok := platform.OrgRole(r.Context())
			if !ok {
				platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Insufficient organization permissions"))
				return
			}
			if _, ok := allowed[role]; !ok {
				platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "Insufficient organization permissions"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
