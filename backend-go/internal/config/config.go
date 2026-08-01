package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds application configuration loaded from the environment.
type Config struct {
	databaseURL string // DATABASE_URL from env
	PGHost      string
	PGDatabase  string
	PGUser      string
	PGPassword  string
	RedisURL    string
	Port        string
	JWTSecret   string
	CookieSecure bool
	CORSOrigins  []string
	DeploymentMode string

	MidtransServerKey    string
	MidtransClientKey    string
	MidtransIsProduction bool

	SelfhostLicenseSecret string
	SelfhostUnlock        bool

	PlatformAdminEmail    string
	PlatformAdminPassword string

	SMTPHost   string
	SMTPPort   int
	SMTPSecure bool
	SMTPUser   string
	SMTPPass   string
	SMTPFrom   string

	GoogleClientID string
	FrontendURL    string
}

// Load reads configuration from the environment.
// A .env file is loaded if present (godotenv); missing file is ignored.
func Load() (*Config, error) {
	_ = godotenv.Load()

	cfg := &Config{
		databaseURL:  os.Getenv("DATABASE_URL"),
		PGHost:       os.Getenv("PGHOST"),
		PGDatabase:   os.Getenv("PGDATABASE"),
		PGUser:       os.Getenv("PGUSER"),
		PGPassword:   os.Getenv("PGPASSWORD"),
		RedisURL:     os.Getenv("REDIS_URL"),
		Port:         getenvDefault("PORT", "8080"),
		JWTSecret:    os.Getenv("JWT_SECRET"),
		CookieSecure: getenvBool("COOKIE_SECURE", false),
		CORSOrigins:  splitCSV(os.Getenv("CORS_ORIGINS")),
		DeploymentMode: getenvDefault("DEPLOYMENT_MODE", "cloud"),

		MidtransServerKey:    os.Getenv("MIDTRANS_SERVER_KEY"),
		MidtransClientKey:    os.Getenv("MIDTRANS_CLIENT_KEY"),
		MidtransIsProduction: getenvBool("MIDTRANS_IS_PRODUCTION", false),

		SelfhostLicenseSecret: os.Getenv("SELFHOST_LICENSE_SECRET"),
		SelfhostUnlock:        getenvBool("SELFHOST_UNLOCK", false),

		PlatformAdminEmail:    os.Getenv("PLATFORM_ADMIN_EMAIL"),
		PlatformAdminPassword: os.Getenv("PLATFORM_ADMIN_PASSWORD"),

		SMTPHost:   os.Getenv("SMTP_HOST"),
		SMTPPort:   getenvInt("SMTP_PORT", 587),
		SMTPSecure: getenvBool("SMTP_SECURE", false),
		SMTPUser:   os.Getenv("SMTP_USER"),
		SMTPPass:   os.Getenv("SMTP_PASS"),
		SMTPFrom:   os.Getenv("SMTP_FROM"),

		GoogleClientID: os.Getenv("GOOGLE_CLIENT_ID"),
		FrontendURL:    getenvDefault("FRONTEND_URL", "http://localhost:5173"),
	}

	return cfg, nil
}

// DatabaseURL returns a usable Postgres connection string.
// When PGHOST starts with "/", a unix-socket URL is built from PG* vars;
// otherwise DATABASE_URL is returned.
func (c *Config) DatabaseURL() string {
	if strings.HasPrefix(c.PGHost, "/") {
		u := url.URL{
			Scheme: "postgresql",
			User:   url.UserPassword(c.PGUser, c.PGPassword),
			Path:   "/" + c.PGDatabase,
		}
		q := u.Query()
		q.Set("host", c.PGHost)
		u.RawQuery = q.Encode()
		return u.String()
	}
	return c.databaseURL
}

func getenvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func getenvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// MustLoad loads config or panics. Useful for cmd entrypoints.
func MustLoad() *Config {
	cfg, err := Load()
	if err != nil {
		panic(fmt.Sprintf("config: %v", err))
	}
	return cfg
}
