package ledger

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DocumentKind for cash documents.
type DocumentKind string

const (
	KindCashIn   DocumentKind = "cash_in"
	KindCashOut  DocumentKind = "cash_out"
	KindTransfer DocumentKind = "transfer"
	KindCapital  DocumentKind = "capital"
)

var kindToDocType = map[DocumentKind]DocumentType{
	KindCashIn:   DocReceipt,
	KindCashOut:  DocPayment,
	KindTransfer: DocJournal,
	KindCapital:  DocJournal,
}

var fullyImplemented = map[DocumentKind]struct{}{
	KindCashIn:   {},
	KindCashOut:  {},
	KindTransfer: {},
	KindCapital:  {},
}

// CreateDocumentInput is input for CreateDocument.
type CreateDocumentInput struct {
	OrgID            string
	UserID           string
	Kind             DocumentKind
	Amount           float64
	Memo             string
	CashAccountID    string
	CounterAccountID string
	IsPrive          bool
	Date             string
	ContactID        *string
}

// DocumentAPI is the API document shape.
type DocumentAPI struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	Status string  `json:"status"`
	Date   string  `json:"date"`
	Amount float64 `json:"amount"`
	Memo   string  `json:"memo"`
}

type accountInfo struct {
	ID     string
	Type   string
	IsCash bool
	Code   string
}

func parseDocumentAmount(amount float64) (float64, error) {
	rounded := math.Round(amount)
	if math.IsNaN(rounded) || math.IsInf(rounded, 0) || rounded <= 0 {
		return 0, platform.NewApiError(http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be a positive integer")
	}
	return rounded, nil
}

func getAccount(ctx context.Context, db *pgxpool.Pool, orgID, accountID, label string) (*accountInfo, error) {
	var a accountInfo
	err := db.QueryRow(ctx, `
		SELECT id, type, is_cash, code FROM accounts WHERE id = $1 AND org_id = $2
	`, accountID, orgID).Scan(&a.ID, &a.Type, &a.IsCash, &a.Code)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, platform.NewApiError(http.StatusNotFound, "ACCOUNT_NOT_FOUND", label+" account not found")
		}
		return nil, err
	}
	return &a, nil
}

func defaultMemo(kind DocumentKind, isPrive bool) string {
	switch kind {
	case KindCashIn:
		return "Kas masuk"
	case KindCashOut:
		return "Kas keluar"
	case KindTransfer:
		return "Transfer kas"
	case KindCapital:
		if isPrive {
			return "Prive"
		}
		return "Setor modal"
	default:
		return "Transaksi"
	}
}

func buildJournalLines(input CreateDocumentInput, amount float64) (lines []JournalLineInput, description string, err error) {
	memo := strings.TrimSpace(input.Memo)
	if memo == "" {
		memo = defaultMemo(input.Kind, input.IsPrive)
	}
	switch input.Kind {
	case KindCashIn:
		if input.CashAccountID == "" || input.CounterAccountID == "" {
			return nil, "", platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
				"cashAccountId and counterAccountId are required for cash_in")
		}
		return []JournalLineInput{
			{AccountID: input.CashAccountID, Debit: amount},
			{AccountID: input.CounterAccountID, Credit: amount},
		}, memo, nil
	case KindCashOut:
		if input.CashAccountID == "" || input.CounterAccountID == "" {
			return nil, "", platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
				"cashAccountId and counterAccountId are required for cash_out")
		}
		return []JournalLineInput{
			{AccountID: input.CounterAccountID, Debit: amount},
			{AccountID: input.CashAccountID, Credit: amount},
		}, memo, nil
	case KindTransfer:
		if input.CashAccountID == "" || input.CounterAccountID == "" {
			return nil, "", platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
				"cashAccountId (source) and counterAccountId (destination) are required for transfer")
		}
		return []JournalLineInput{
			{AccountID: input.CounterAccountID, Debit: amount},
			{AccountID: input.CashAccountID, Credit: amount},
		}, memo, nil
	case KindCapital:
		if input.IsPrive {
			return []JournalLineInput{
				{AccountID: input.CounterAccountID, Debit: amount},
				{AccountID: input.CashAccountID, Credit: amount},
			}, memo, nil
		}
		return []JournalLineInput{
			{AccountID: input.CashAccountID, Debit: amount},
			{AccountID: input.CounterAccountID, Credit: amount},
		}, memo, nil
	default:
		return nil, "", platform.NewApiError(http.StatusNotImplemented, "NOT_IMPLEMENTED",
			"Document kind '"+string(input.Kind)+"' is not implemented yet")
	}
}

func resolveAccounts(ctx context.Context, db *pgxpool.Pool, input CreateDocumentInput) (CreateDocumentInput, error) {
	resolved := input

	if resolved.Kind == KindCapital {
		if resolved.CashAccountID == "" {
			id, err := GetDefaultCashAccount(ctx, db, resolved.OrgID)
			if err != nil {
				return resolved, err
			}
			resolved.CashAccountID = id
		}
		if resolved.CounterAccountID == "" {
			code := "3100"
			if resolved.IsPrive {
				code = "3200"
			}
			id, err := GetSystemAccountByCode(ctx, db, resolved.OrgID, code)
			if err != nil {
				return resolved, err
			}
			resolved.CounterAccountID = id
		}
		return resolved, nil
	}

	if resolved.Kind == KindTransfer {
		if resolved.CashAccountID == "" || resolved.CounterAccountID == "" {
			return resolved, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
				"cashAccountId (source) and counterAccountId (destination) are required for transfer")
		}
		source, err := getAccount(ctx, db, resolved.OrgID, resolved.CashAccountID, "Source")
		if err != nil {
			return resolved, err
		}
		dest, err := getAccount(ctx, db, resolved.OrgID, resolved.CounterAccountID, "Destination")
		if err != nil {
			return resolved, err
		}
		if !source.IsCash || !dest.IsCash {
			return resolved, platform.NewApiError(http.StatusBadRequest, "INVALID_ACCOUNT",
				"Transfer requires both accounts to be cash accounts")
		}
		if source.ID == dest.ID {
			return resolved, platform.NewApiError(http.StatusBadRequest, "INVALID_ACCOUNT",
				"Source and destination must differ")
		}
		return resolved, nil
	}

	if resolved.Kind == KindCashIn || resolved.Kind == KindCashOut {
		if resolved.CashAccountID == "" {
			id, err := GetDefaultCashAccount(ctx, db, resolved.OrgID)
			if err != nil {
				return resolved, err
			}
			resolved.CashAccountID = id
		}
		if resolved.CounterAccountID == "" {
			return resolved, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "counterAccountId is required")
		}
		cash, err := getAccount(ctx, db, resolved.OrgID, resolved.CashAccountID, "Cash")
		if err != nil {
			return resolved, err
		}
		if !cash.IsCash {
			return resolved, platform.NewApiError(http.StatusBadRequest, "INVALID_ACCOUNT", "Cash account must be a cash account")
		}
	}

	return resolved, nil
}

// CreateDocument creates a cash/capital document and posts its journal.
func CreateDocument(ctx context.Context, db *pgxpool.Pool, input CreateDocumentInput) (*DocumentAPI, error) {
	if _, ok := fullyImplemented[input.Kind]; !ok {
		return nil, platform.NewApiError(http.StatusNotImplemented, "NOT_IMPLEMENTED",
			"Document kind '"+string(input.Kind)+"' is not implemented yet")
	}

	amount, err := parseDocumentAmount(input.Amount)
	if err != nil {
		return nil, err
	}
	dateStr, err := documentDate(input.Date)
	if err != nil {
		return nil, err
	}
	entryDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return nil, platform.NewApiError(http.StatusBadRequest, "INVALID_DATE", "Date must be YYYY-MM-DD")
	}

	resolved, err := resolveAccounts(ctx, db, input)
	if err != nil {
		return nil, err
	}
	documentType := kindToDocType[resolved.Kind]
	lines, description, err := buildJournalLines(resolved, amount)
	if err != nil {
		return nil, err
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	number, err := NextDocumentNumber(ctx, tx, resolved.OrgID, documentType)
	if err != nil {
		return nil, err
	}

	meta, _ := json.Marshal(map[string]any{
		"kind":             string(resolved.Kind),
		"isPrive":          resolved.IsPrive,
		"cashAccountId":    resolved.CashAccountID,
		"counterAccountId": resolved.CounterAccountID,
	})

	var docID, status, docDate string
	var docDesc *string
	err = tx.QueryRow(ctx, `
		INSERT INTO documents (org_id, type, number, contact_id, date, status, description, total_amount, metadata)
		VALUES ($1, $2, $3, $4, $5, 'posted', $6, $7, $8)
		RETURNING id, status, date::text, description
	`, resolved.OrgID, string(documentType), number, resolved.ContactID, dateStr, description, formatAmount(amount), meta,
	).Scan(&docID, &status, &docDate, &docDesc)
	if err != nil {
		return nil, err
	}

	userID := resolved.UserID
	_, err = PostJournal(ctx, db, PostJournalInput{
		OrgID:       resolved.OrgID,
		Date:        entryDate,
		Description: description,
		Lines:       lines,
		DocumentID:  &docID,
		UserID:      &userID,
		Tx:          tx,
	})
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	memo := ""
	if docDesc != nil {
		memo = *docDesc
	}
	return &DocumentAPI{
		ID:     docID,
		Kind:   string(resolved.Kind),
		Status: status,
		Date:   docDate,
		Amount: amount,
		Memo:   memo,
	}, nil
}

func documentDate(date string) (string, error) {
	value := date
	if value == "" {
		value = time.Now().UTC().Format("2006-01-02")
	}
	if !dateRe.MatchString(value) {
		return "", platform.NewApiError(http.StatusBadRequest, "INVALID_DATE", "Date must be YYYY-MM-DD")
	}
	return value, nil
}

// DocumentToAPI maps a DB document row to API shape.
func DocumentToAPI(id, docType, status, date, totalAmount string, description *string, metadata []byte) DocumentAPI {
	kind := docType
	if len(metadata) > 0 {
		var m map[string]any
		if json.Unmarshal(metadata, &m) == nil {
			if k, ok := m["kind"].(string); ok && k != "" {
				kind = k
			}
		}
	}
	memo := ""
	if description != nil {
		memo = *description
	}
	f, _ := strconv.ParseFloat(totalAmount, 64)
	return DocumentAPI{
		ID:     id,
		Kind:   kind,
		Status: status,
		Date:   date,
		Amount: math.Round(f),
		Memo:   memo,
	}
}
