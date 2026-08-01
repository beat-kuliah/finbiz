package ledger

import (
	"context"
	"math"
	"net/http"
	"time"

	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const amountTolerance = 0.01

// JournalLineInput is a single journal line.
type JournalLineInput struct {
	AccountID   string
	Debit       float64
	Credit      float64
	Description string
}

// PostJournalInput is the input for PostJournal.
type PostJournalInput struct {
	OrgID       string
	Date        time.Time
	Description string
	Lines       []JournalLineInput
	DocumentID  *string
	UserID      *string
	Tx          pgx.Tx
}

func validateBalanced(lines []JournalLineInput) error {
	if len(lines) < 2 {
		return platform.NewApiError(http.StatusBadRequest, "JOURNAL_UNBALANCED", "Journal must have at least two lines")
	}
	var totalDebit, totalCredit float64
	for _, line := range lines {
		if line.Debit < 0 || line.Credit < 0 {
			return platform.NewApiError(http.StatusBadRequest, "INVALID_AMOUNT", "Debit and credit amounts must be non-negative")
		}
		if line.Debit > 0 && line.Credit > 0 {
			return platform.NewApiError(http.StatusBadRequest, "INVALID_LINE", "A line cannot have both debit and credit")
		}
		if line.Debit == 0 && line.Credit == 0 {
			return platform.NewApiError(http.StatusBadRequest, "INVALID_LINE", "A line must have either debit or credit")
		}
		totalDebit += line.Debit
		totalCredit += line.Credit
	}
	totalDebit = Round2(totalDebit)
	totalCredit = Round2(totalCredit)
	if math.Abs(totalDebit-totalCredit) > amountTolerance {
		return platform.NewApiError(http.StatusBadRequest, "JOURNAL_UNBALANCED",
			"Debits must equal credits")
	}
	return nil
}

func insertJournalEntry(ctx context.Context, tx pgx.Tx, input PostJournalInput) (string, error) {
	entryDate := input.Date.UTC().Format("2006-01-02")
	var entryID string
	err := tx.QueryRow(ctx, `
		INSERT INTO journal_entries (org_id, document_id, entry_date, description, status, posted_at, created_by)
		VALUES ($1, $2, $3, $4, 'posted', now(), $5)
		RETURNING id
	`, input.OrgID, input.DocumentID, entryDate, input.Description, input.UserID).Scan(&entryID)
	if err != nil {
		return "", err
	}

	for i, line := range input.Lines {
		var desc *string
		if line.Description != "" {
			d := line.Description
			desc = &d
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO journal_lines (entry_id, account_id, debit, credit, description, line_order)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, entryID, line.AccountID, formatAmount(line.Debit), formatAmount(line.Credit), desc, i)
		if err != nil {
			return "", err
		}
	}
	return entryID, nil
}

// PostJournal validates and posts a balanced journal entry.
func PostJournal(ctx context.Context, db *pgxpool.Pool, input PostJournalInput) (entryID string, err error) {
	if err := validateBalanced(input.Lines); err != nil {
		return "", err
	}

	accountIDs := map[string]struct{}{}
	for _, l := range input.Lines {
		accountIDs[l.AccountID] = struct{}{}
	}

	var q interface {
		Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	}
	if input.Tx != nil {
		q = input.Tx
	} else {
		q = db
	}

	rows, err := q.Query(ctx, `SELECT id FROM accounts WHERE org_id = $1`, input.OrgID)
	if err != nil {
		return "", err
	}
	found := map[string]struct{}{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return "", err
		}
		found[id] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}

	for id := range accountIDs {
		if _, ok := found[id]; !ok {
			return "", platform.NewApiError(http.StatusNotFound, "ACCOUNT_NOT_FOUND",
				"Account not found in organization")
		}
	}

	if input.Tx != nil {
		return insertJournalEntry(ctx, input.Tx, input)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	entryID, err = insertJournalEntry(ctx, tx, input)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return entryID, nil
}

// VoidJournal marks a posted journal as void (DB status "void").
func VoidJournal(ctx context.Context, db *pgxpool.Pool, entryID, orgID string) error {
	var status string
	err := db.QueryRow(ctx, `
		SELECT status FROM journal_entries WHERE id = $1 AND org_id = $2
	`, entryID, orgID).Scan(&status)
	if err != nil {
		if err == pgx.ErrNoRows {
			return platform.NewApiError(http.StatusNotFound, "JOURNAL_NOT_FOUND", "Journal entry not found")
		}
		return err
	}
	if status == "void" {
		return platform.NewApiError(http.StatusBadRequest, "JOURNAL_ALREADY_VOID", "Journal entry already voided")
	}
	if status != "posted" {
		return platform.NewApiError(http.StatusBadRequest, "JOURNAL_NOT_POSTED", "Only posted entries can be voided")
	}
	_, err = db.Exec(ctx, `
		UPDATE journal_entries SET status = 'void', voided_at = now() WHERE id = $1
	`, entryID)
	return err
}
