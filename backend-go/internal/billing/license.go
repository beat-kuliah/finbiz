package billing

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var licenseKeyRe = regexp.MustCompile(`^FBIZ-([A-Za-z0-9_-]+)\.([a-f0-9]{16})$`)

// LicensePayload is the decoded license key body.
type LicensePayload struct {
	PlanCode  string  `json:"planCode"`
	MaxOrgs   int     `json:"maxOrgs"`
	MaxSeats  int     `json:"maxSeats"`
	ExpiresAt *string `json:"expiresAt"`
}

type licenseWire struct {
	P string  `json:"p"`
	O int     `json:"o"`
	S int     `json:"s"`
	E *string `json:"e"`
	N string  `json:"n"`
}

// GenerateLicenseKey creates FBIZ-<base64url payload>.{hmac hex 16}.
func (s *Service) GenerateLicenseKey(planCode string, maxOrgs, maxSeats int, expiresAt *string) (string, error) {
	secret := s.licenseSecret()
	nonce := make([]byte, 4)
	_, _ = rand.Read(nonce)
	wire := licenseWire{
		P: planCode,
		O: maxOrgs,
		S: maxSeats,
		E: expiresAt,
		N: hex.EncodeToString(nonce),
	}
	data, err := json.Marshal(wire)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(data)
	sig := hex.EncodeToString(mac.Sum(nil))[:16]
	body := base64.RawURLEncoding.EncodeToString(data)
	return fmt.Sprintf("FBIZ-%s.%s", body, sig), nil
}

// VerifyLicenseKey validates HMAC and returns the payload, or nil if invalid.
func (s *Service) VerifyLicenseKey(key string) *LicensePayload {
	match := licenseKeyRe.FindStringSubmatch(key)
	if match == nil {
		return nil
	}
	body, sig := match[1], match[2]
	data, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return nil
	}
	mac := hmac.New(sha256.New, []byte(s.licenseSecret()))
	mac.Write(data)
	expected := hex.EncodeToString(mac.Sum(nil))[:16]
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return nil
	}
	var wire licenseWire
	if err := json.Unmarshal(data, &wire); err != nil {
		return nil
	}
	return &LicensePayload{
		PlanCode:  wire.P,
		MaxOrgs:   wire.O,
		MaxSeats:  wire.S,
		ExpiresAt: wire.E,
	}
}

// IsLicenseFeatureEnabled is true for selfhost mode or SELFHOST_UNLOCK.
func (s *Service) IsLicenseFeatureEnabled() bool {
	if s.cfg == nil {
		return false
	}
	return s.cfg.DeploymentMode == "selfhost" || s.cfg.SelfhostUnlock
}

func (s *Service) licenseSecret() string {
	if s.cfg == nil {
		return ""
	}
	return s.cfg.SelfhostLicenseSecret
}

// NormalizeInterval validates monthly/yearly.
func NormalizeInterval(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if v == "yearly" {
		return "yearly"
	}
	return "monthly"
}
