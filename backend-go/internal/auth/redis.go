package auth

import "time"

const (
	refreshPrefix      = "refresh:"
	adminRefreshPrefix = "admin_refresh:"
	RefreshTTL         = 30 * 24 * time.Hour
	RefreshTTLSeconds  = 60 * 60 * 24 * 30
)

func refreshKey(tokenID string) string {
	return refreshPrefix + tokenID
}

func adminRefreshKey(tokenID string) string {
	return adminRefreshPrefix + tokenID
}

func scopeKey(tokenID, scope string) string {
	if scope == ScopePlatform {
		return adminRefreshKey(tokenID)
	}
	return refreshKey(tokenID)
}
