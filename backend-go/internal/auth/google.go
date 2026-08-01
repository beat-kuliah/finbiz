package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const googleCertsURL = "https://www.googleapis.com/oauth2/v3/certs"

type googleJWKSet struct {
	Keys []googleJWK `json:"keys"`
}

type googleJWK struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
	Use string `json:"use"`
}

type googleIDClaims struct {
	Email         string `json:"email"`
	EmailVerified any    `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	jwt.RegisteredClaims
}

var (
	googleKeysMu    sync.Mutex
	googleKeysCache map[string]*rsa.PublicKey
	googleKeysExp   time.Time
)

func (s *Service) verifyGoogleIDToken(ctx context.Context, idToken string) (*googleIDClaims, error) {
	if s.cfg.GoogleClientID == "" {
		return nil, fmt.Errorf("GOOGLE_CLIENT_ID not configured")
	}

	keys, err := getGooglePublicKeys(ctx)
	if err != nil {
		return nil, err
	}

	token, err := jwt.ParseWithClaims(idToken, &googleIDClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != "RS256" {
			return nil, fmt.Errorf("unexpected signing method")
		}
		kid, _ := t.Header["kid"].(string)
		key, ok := keys[kid]
		if !ok {
			return nil, fmt.Errorf("unknown kid")
		}
		return key, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*googleIDClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid google token")
	}

	audOK := false
	for _, a := range claims.Audience {
		if a == s.cfg.GoogleClientID {
			audOK = true
			break
		}
	}
	if !audOK {
		return nil, fmt.Errorf("invalid audience")
	}

	issOK := claims.Issuer == "https://accounts.google.com" || claims.Issuer == "accounts.google.com"
	if !issOK {
		return nil, fmt.Errorf("invalid issuer")
	}
	if claims.Subject == "" {
		return nil, fmt.Errorf("missing subject")
	}
	if claims.Email == "" {
		return nil, fmt.Errorf("missing email")
	}
	if !googleEmailVerified(claims.EmailVerified) {
		return nil, fmt.Errorf("email not verified")
	}
	return claims, nil
}

func googleEmailVerified(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true")
	default:
		return false
	}
}

func getGooglePublicKeys(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	googleKeysMu.Lock()
	defer googleKeysMu.Unlock()
	if googleKeysCache != nil && time.Now().Before(googleKeysExp) {
		return googleKeysCache, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleCertsURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google certs status %d", resp.StatusCode)
	}

	var set googleJWKSet
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return nil, err
	}

	out := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		pub, err := jwkToRSA(k)
		if err != nil {
			continue
		}
		out[k.Kid] = pub
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no google public keys")
	}
	googleKeysCache = out
	googleKeysExp = time.Now().Add(1 * time.Hour)
	return out, nil
}

func jwkToRSA(k googleJWK) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, err
	}
	var eInt int
	for _, b := range eb {
		eInt = eInt<<8 + int(b)
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: eInt}, nil
}
