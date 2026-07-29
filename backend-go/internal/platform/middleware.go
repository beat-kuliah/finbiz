package platform

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

// CORS returns chi CORS middleware allowing credentials and org/auth headers.
func CORS(origins []string) func(http.Handler) http.Handler {
	if len(origins) == 0 {
		origins = []string{"http://localhost:5173", "http://localhost:5174"}
	}
	return cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "X-Organization-Id"},
		ExposedHeaders:   []string{"Link", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	})
}

// Recoverer recovers from panics and maps ApiError to JSON responses.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				var apiErr *ApiError
				switch v := rec.(type) {
				case *ApiError:
					apiErr = v
				case ApiError:
					copied := v
					apiErr = &copied
				case error:
					if !errors.As(v, &apiErr) {
						apiErr = NewApiError(http.StatusInternalServerError, "internal_error", "internal server error")
					}
				default:
					apiErr = NewApiError(http.StatusInternalServerError, "internal_error", "internal server error")
				}
				if apiErr == nil {
					apiErr = NewApiError(http.StatusInternalServerError, "internal_error", "internal server error")
				}
				WriteError(w, apiErr)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// RequestID is optional request-id middleware (chi).
func RequestID(next http.Handler) http.Handler {
	return middleware.RequestID(next)
}
