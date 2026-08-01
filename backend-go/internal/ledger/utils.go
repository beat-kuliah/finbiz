package ledger

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"time"

	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// COA_CODES are well-known system account codes.
var COA_CODES = struct {
	KAS             string
	PIUTANG         string
	HUTANG_USAHA    string
	HUTANG_BANK     string
	ASET_TETAP      string
	AKUM_PENYUSUTAN string
	PENDAPATAN      string
	PENDAPATAN_LAIN string
	BEBAN_PENYUSUTAN string
	BEBAN_LAIN      string
}{
	KAS:              "1100",
	PIUTANG:          "1300",
	HUTANG_USAHA:     "2100",
	HUTANG_BANK:      "2200",
	ASET_TETAP:       "1500",
	AKUM_PENYUSUTAN:  "1510",
	PENDAPATAN:       "4100",
	PENDAPATAN_LAIN:  "4200",
	BEBAN_PENYUSUTAN: "5200",
	BEBAN_LAIN:       "5300",
}

// DocumentType matches the document_type enum.
type DocumentType string

const (
	DocInvoice    DocumentType = "invoice"
	DocBill       DocumentType = "bill"
	DocPayment    DocumentType = "payment"
	DocReceipt    DocumentType = "receipt"
	DocJournal    DocumentType = "journal"
	DocAdjustment DocumentType = "adjustment"
	DocOther      DocumentType = "other"
)

var defaultPrefix = map[DocumentType]string{
	DocInvoice:    "INV-",
	DocBill:       "BIL-",
	DocPayment:    "PY-",
	DocReceipt:    "RC-",
	DocJournal:    "JV-",
	DocAdjustment: "ADJ-",
	DocOther:      "DOC-",
}

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// Round2 rounds to 2 decimal places.
func Round2(n float64) float64 {
	return math.Round(n*100) / 100
}

// ParseAmount validates a positive amount (2dp).
func ParseAmount(amount float64) (float64, error) {
	rounded := Round2(amount)
	if math.IsNaN(rounded) || math.IsInf(rounded, 0) || rounded <= 0 {
		return 0, platform.NewApiError(http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be positive")
	}
	return rounded, nil
}

// ParseDate validates YYYY-MM-DD (defaults to today UTC).
func ParseDate(date string) (string, error) {
	value := date
	if value == "" {
		value = time.Now().UTC().Format("2006-01-02")
	}
	if !dateRe.MatchString(value) {
		return "", platform.NewApiError(http.StatusBadRequest, "INVALID_DATE", "Date must be YYYY-MM-DD")
	}
	return value, nil
}

// GetSystemAccountByCode returns the account id for a system COA code.
func GetSystemAccountByCode(ctx context.Context, db *pgxpool.Pool, orgID, code string) (string, error) {
	var id string
	err := db.QueryRow(ctx, `
		SELECT id FROM accounts WHERE org_id = $1 AND code = $2
	`, orgID, code).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", platform.NewApiError(http.StatusNotFound, "ACCOUNT_NOT_FOUND",
				fmt.Sprintf("System account %s not found", code))
		}
		return "", err
	}
	return id, nil
}

// GetDefaultCashAccount returns the first cash account for the org.
func GetDefaultCashAccount(ctx context.Context, db *pgxpool.Pool, orgID string) (string, error) {
	var id string
	err := db.QueryRow(ctx, `
		SELECT id FROM accounts WHERE org_id = $1 AND is_cash = true LIMIT 1
	`, orgID).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", platform.NewApiError(http.StatusNotFound, "ACCOUNT_NOT_FOUND", "No cash account configured")
		}
		return "", err
	}
	return id, nil
}

// Querier is satisfied by *pgxpool.Pool and pgx.Tx.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// NextDocumentNumber allocates the next document number inside a transaction.
func NextDocumentNumber(ctx context.Context, q Querier, orgID string, documentType DocumentType) (string, error) {
	var (
		id         string
		prefix     string
		nextNumber int
		padding    int
	)
	err := q.QueryRow(ctx, `
		SELECT id, prefix, next_number, padding
		FROM document_sequences
		WHERE org_id = $1 AND document_type = $2
	`, orgID, string(documentType)).Scan(&id, &prefix, &nextNumber, &padding)

	if err == pgx.ErrNoRows {
		prefix = defaultPrefix[documentType]
		if prefix == "" {
			prefix = "DOC-"
		}
		nextNumber = 1
		padding = 4
		err = q.QueryRow(ctx, `
			INSERT INTO document_sequences (org_id, document_type, prefix, next_number, padding)
			VALUES ($1, $2, $3, 1, 4)
			RETURNING id, prefix, next_number, padding
		`, orgID, string(documentType), prefix).Scan(&id, &prefix, &nextNumber, &padding)
		if err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	}

	number := fmt.Sprintf("%s%0*d", prefix, padding, nextNumber)
	_, err = q.Exec(ctx, `
		UPDATE document_sequences SET next_number = $1, updated_at = now() WHERE id = $2
	`, nextNumber+1, id)
	if err != nil {
		return "", err
	}
	return number, nil
}

func formatAmount(n float64) string {
	return fmt.Sprintf("%.2f", Round2(n))
}

func computeBalance(accountType string, totalDebit, totalCredit float64) float64 {
	if accountType == "asset" || accountType == "expense" {
		return math.Round(totalDebit - totalCredit)
	}
	return math.Round(totalCredit - totalDebit)
}

func mapJournalStatus(status string) string {
	if status == "void" {
		return "voided"
	}
	return status
}

func writeAPIError(w http.ResponseWriter, err error) {
	if api, ok := err.(*platform.ApiError); ok {
		platform.JSONError(w, api)
		return
	}
	platform.JSONError(w, platform.NewApiError(http.StatusInternalServerError, "INTERNAL", "Internal server error"))
}
