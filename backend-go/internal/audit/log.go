package audit

import (
	"context"
	"encoding/json"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Log inserts an audit_logs row. Failures are logged and never returned to callers.
func Log(ctx context.Context, db *pgxpool.Pool, orgID, userID, action, entityType, entityID string, metadata any) {
	if db == nil || action == "" || entityType == "" {
		return
	}
	var metaJSON []byte
	if metadata != nil {
		b, err := json.Marshal(metadata)
		if err != nil {
			log.Printf("audit: marshal metadata: %v", err)
			return
		}
		metaJSON = b
	}

	var orgArg, userArg, entityArg any
	if orgID != "" {
		orgArg = orgID
	}
	if userID != "" {
		userArg = userID
	}
	if entityID != "" {
		entityArg = entityID
	}

	_, err := db.Exec(ctx, `
		INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, orgArg, userArg, action, entityType, entityArg, metaJSON)
	if err != nil {
		log.Printf("audit: insert failed action=%s entity=%s: %v", action, entityType, err)
	}
}
