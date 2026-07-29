package arap

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/icus/finbiz/backend-go/internal/ledger"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OpenItemKind is receivable or payable.
type OpenItemKind string

const (
	KindReceivable OpenItemKind = "receivable"
	KindPayable    OpenItemKind = "payable"
)

// DocumentKind for ARAP documents.
type DocumentKind string

const (
	KindInvoice     DocumentKind = "invoice"
	KindReceipt     DocumentKind = "receipt"
	KindLoanIn      DocumentKind = "loan_in"
	KindLoanPayment DocumentKind = "loan_payment"
)

// DocumentInput is input for create ARAP documents.
type DocumentInput struct {
	OrgID         string
	UserID        string
	Amount        float64
	Memo          string
	Date          string
	DueDate       string
	ContactID     string
	OpenItemID    string
	DocumentID    string
	CashAccountID string
}

// DocumentResult is the ARAP document API shape.
type DocumentResult struct {
	ID         string  `json:"id"`
	Kind       string  `json:"kind"`
	Status     string  `json:"status"`
	Date       string  `json:"date"`
	Amount     float64 `json:"amount"`
	Memo       string  `json:"memo"`
	OpenItemID *string `json:"openItemId,omitempty"`
}

// OpenItemRow is a listed open item.
type OpenItemRow struct {
	ID             string  `json:"id"`
	Type           string  `json:"type"`
	ContactID      *string `json:"contactId"`
	DocumentID     *string `json:"documentId"`
	Description    string  `json:"description"`
	OriginalAmount float64 `json:"originalAmount"`
	BalanceAmount  float64 `json:"balanceAmount"`
	DueDate        *string `json:"dueDate"`
	Status         string  `json:"status"`
	CreatedAt      string  `json:"createdAt"`
}

// AgingBucket aggregates aging balances.
type AgingBucket struct {
	Current    float64 `json:"current"`
	Days1to30  float64 `json:"days1to30"`
	Days31to60 float64 `json:"days31to60"`
	Days61to90 float64 `json:"days61to90"`
	Days90plus float64 `json:"days90plus"`
	Total      float64 `json:"total"`
}

// AgingRow is one aging report line.
type AgingRow struct {
	ContactID     *string `json:"contactId"`
	ContactName   *string `json:"contactName"`
	OpenItemID    string  `json:"openItemId"`
	Description   string  `json:"description"`
	DueDate       *string `json:"dueDate"`
	BalanceAmount float64 `json:"balanceAmount"`
	Bucket        string  `json:"bucket"`
}

// AgingReport is the aging report response.
type AgingReport struct {
	Kind    OpenItemKind `json:"kind"`
	Buckets AgingBucket  `json:"buckets"`
	Items   []AgingRow   `json:"items"`
}

type openItemRecord struct {
	ID             string
	ContactID      *string
	DocumentID     *string
	Description    string
	OriginalAmount float64
	BalanceAmount  float64
	DueDate        *string
	Status         string
}

var kindToDocType = map[DocumentKind]ledger.DocumentType{
	KindInvoice:     ledger.DocInvoice,
	KindReceipt:     ledger.DocReceipt,
	KindLoanIn:      ledger.DocJournal,
	KindLoanPayment: ledger.DocPayment,
}

func defaultMemo(kind DocumentKind) string {
	switch kind {
	case KindInvoice:
		return "Faktur penjualan"
	case KindReceipt:
		return "Penerimaan piutang"
	case KindLoanIn:
		return "Penerimaan pinjaman"
	case KindLoanPayment:
		return "Pembayaran pinjaman"
	default:
		return "Transaksi"
	}
}

func formatAmt(n float64) string {
	return fmt.Sprintf("%.2f", ledger.Round2(n))
}

func assertContact(ctx context.Context, db *pgxpool.Pool, orgID, contactID string) error {
	var id string
	err := db.QueryRow(ctx, `
		SELECT id FROM contacts WHERE id = $1 AND org_id = $2
	`, contactID, orgID).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return platform.NewApiError(http.StatusNotFound, "CONTACT_NOT_FOUND", "Contact not found")
		}
		return err
	}
	return nil
}

func findOpenItem(ctx context.Context, db *pgxpool.Pool, orgID string, itemType OpenItemKind, openItemID, documentID string) (*openItemRecord, error) {
	if openItemID != "" {
		var item openItemRecord
		var origS, balS string
		err := db.QueryRow(ctx, `
			SELECT id, contact_id, document_id, description,
				original_amount::text, balance_amount::text, due_date::text, status
			FROM open_items
			WHERE id = $1 AND org_id = $2 AND type = $3
		`, openItemID, orgID, string(itemType)).Scan(
			&item.ID, &item.ContactID, &item.DocumentID, &item.Description,
			&origS, &balS, &item.DueDate, &item.Status,
		)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, platform.NewApiError(http.StatusNotFound, "OPEN_ITEM_NOT_FOUND", "Open item not found")
			}
			return nil, err
		}
		item.OriginalAmount, _ = strconv.ParseFloat(origS, 64)
		item.BalanceAmount, _ = strconv.ParseFloat(balS, 64)
		if item.Status == "closed" {
			return nil, platform.NewApiError(http.StatusBadRequest, "OPEN_ITEM_CLOSED", "Open item is already closed")
		}
		return &item, nil
	}

	if documentID != "" {
		var item openItemRecord
		var origS, balS string
		err := db.QueryRow(ctx, `
			SELECT id, contact_id, document_id, description,
				original_amount::text, balance_amount::text, due_date::text, status
			FROM open_items
			WHERE document_id = $1 AND org_id = $2 AND type = $3
		`, documentID, orgID, string(itemType)).Scan(
			&item.ID, &item.ContactID, &item.DocumentID, &item.Description,
			&origS, &balS, &item.DueDate, &item.Status,
		)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, platform.NewApiError(http.StatusNotFound, "OPEN_ITEM_NOT_FOUND",
					"No open item linked to this document")
			}
			return nil, err
		}
		item.OriginalAmount, _ = strconv.ParseFloat(origS, 64)
		item.BalanceAmount, _ = strconv.ParseFloat(balS, 64)
		if item.Status == "closed" {
			return nil, platform.NewApiError(http.StatusBadRequest, "OPEN_ITEM_CLOSED", "Open item is already closed")
		}
		return &item, nil
	}

	return nil, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR",
		"openItemId or documentId is required")
}

func updateOpenItemStatus(balance, original float64) string {
	if balance <= 0.01 {
		return "closed"
	}
	if balance < original-0.01 {
		return "partial"
	}
	return "open"
}

func reduceOpenItem(ctx context.Context, tx pgx.Tx, item *openItemRecord, paymentAmount float64) error {
	if paymentAmount > item.BalanceAmount+0.01 {
		return platform.NewApiError(http.StatusBadRequest, "INVALID_AMOUNT",
			"Payment exceeds open item balance")
	}
	newBalance := ledger.Round2(item.BalanceAmount - paymentAmount)
	if newBalance < 0 {
		newBalance = 0
	}
	status := updateOpenItemStatus(newBalance, item.OriginalAmount)
	_, err := tx.Exec(ctx, `
		UPDATE open_items SET balance_amount = $1, status = $2 WHERE id = $3
	`, formatAmt(newBalance), status, item.ID)
	return err
}

// CreateArapDocument creates an invoice, receipt, loan_in, or loan_payment.
func CreateArapDocument(ctx context.Context, db *pgxpool.Pool, kind DocumentKind, input DocumentInput) (*DocumentResult, error) {
	amount, err := ledger.ParseAmount(input.Amount)
	if err != nil {
		return nil, err
	}
	dateStr, err := ledger.ParseDate(input.Date)
	if err != nil {
		return nil, err
	}
	entryDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return nil, platform.NewApiError(http.StatusBadRequest, "INVALID_DATE", "Date must be YYYY-MM-DD")
	}

	memo := strings.TrimSpace(input.Memo)
	if memo == "" {
		memo = defaultMemo(kind)
	}
	documentType := kindToDocType[kind]

	if input.ContactID != "" {
		if err := assertContact(ctx, db, input.OrgID, input.ContactID); err != nil {
			return nil, err
		}
	}

	kasID := input.CashAccountID
	if kasID == "" {
		kasID, err = ledger.GetDefaultCashAccount(ctx, db, input.OrgID)
		if err != nil {
			return nil, err
		}
	}
	piutangID, err := ledger.GetSystemAccountByCode(ctx, db, input.OrgID, ledger.COA_CODES.PIUTANG)
	if err != nil {
		return nil, err
	}
	pendapatanID, err := ledger.GetSystemAccountByCode(ctx, db, input.OrgID, ledger.COA_CODES.PENDAPATAN)
	if err != nil {
		return nil, err
	}
	hutangID, err := ledger.GetSystemAccountByCode(ctx, db, input.OrgID, ledger.COA_CODES.HUTANG_BANK)
	if err != nil {
		return nil, err
	}

	var openItemToReduce *openItemRecord
	if kind == KindReceipt {
		openItemToReduce, err = findOpenItem(ctx, db, input.OrgID, KindReceivable, input.OpenItemID, input.DocumentID)
		if err != nil {
			return nil, err
		}
	} else if kind == KindLoanPayment {
		openItemToReduce, err = findOpenItem(ctx, db, input.OrgID, KindPayable, input.OpenItemID, input.DocumentID)
		if err != nil {
			return nil, err
		}
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	number, err := ledger.NextDocumentNumber(ctx, tx, input.OrgID, documentType)
	if err != nil {
		return nil, err
	}

	var contactID *string
	if input.ContactID != "" {
		contactID = &input.ContactID
	} else if openItemToReduce != nil {
		contactID = openItemToReduce.ContactID
	}

	var dueDate *string
	if input.DueDate != "" {
		dueDate = &input.DueDate
	}

	meta := map[string]any{"kind": string(kind)}
	if input.OpenItemID != "" {
		meta["openItemId"] = input.OpenItemID
	}
	if input.DocumentID != "" {
		meta["sourceDocumentId"] = input.DocumentID
	}
	metaBytes, _ := json.Marshal(meta)

	var docID, status, docDate string
	var docDesc *string
	err = tx.QueryRow(ctx, `
		INSERT INTO documents (org_id, type, number, contact_id, date, due_date, status, description, total_amount, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7, $8, $9)
		RETURNING id, status, date::text, description
	`, input.OrgID, string(documentType), number, contactID, dateStr, dueDate, memo, formatAmt(amount), metaBytes,
	).Scan(&docID, &status, &docDate, &docDesc)
	if err != nil {
		return nil, err
	}

	var lines []ledger.JournalLineInput
	switch kind {
	case KindInvoice:
		lines = []ledger.JournalLineInput{
			{AccountID: piutangID, Debit: amount},
			{AccountID: pendapatanID, Credit: amount},
		}
	case KindReceipt:
		lines = []ledger.JournalLineInput{
			{AccountID: kasID, Debit: amount},
			{AccountID: piutangID, Credit: amount},
		}
	case KindLoanIn:
		lines = []ledger.JournalLineInput{
			{AccountID: kasID, Debit: amount},
			{AccountID: hutangID, Credit: amount},
		}
	case KindLoanPayment:
		lines = []ledger.JournalLineInput{
			{AccountID: hutangID, Debit: amount},
			{AccountID: kasID, Credit: amount},
		}
	}

	userID := input.UserID
	_, err = ledger.PostJournal(ctx, db, ledger.PostJournalInput{
		OrgID:       input.OrgID,
		Date:        entryDate,
		Description: memo,
		Lines:       lines,
		DocumentID:  &docID,
		UserID:      &userID,
		Tx:          tx,
	})
	if err != nil {
		return nil, err
	}

	var openItemID *string
	if kind == KindInvoice || kind == KindLoanIn {
		itemType := KindReceivable
		if kind == KindLoanIn {
			itemType = KindPayable
		}
		var oid string
		err = tx.QueryRow(ctx, `
			INSERT INTO open_items (org_id, type, contact_id, document_id, description,
				original_amount, balance_amount, due_date, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
			RETURNING id
		`, input.OrgID, string(itemType), contactID, docID, memo,
			formatAmt(amount), formatAmt(amount), dueDate,
		).Scan(&oid)
		if err != nil {
			return nil, err
		}
		openItemID = &oid
	}

	if openItemToReduce != nil {
		if err := reduceOpenItem(ctx, tx, openItemToReduce, amount); err != nil {
			return nil, err
		}
		openItemID = &openItemToReduce.ID
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	outMemo := ""
	if docDesc != nil {
		outMemo = *docDesc
	}
	return &DocumentResult{
		ID:         docID,
		Kind:       string(kind),
		Status:     status,
		Date:       docDate,
		Amount:     math.Round(amount),
		Memo:       outMemo,
		OpenItemID: openItemID,
	}, nil
}

// CreateInvoice creates a sales invoice.
func CreateInvoice(ctx context.Context, db *pgxpool.Pool, input DocumentInput) (*DocumentResult, error) {
	return CreateArapDocument(ctx, db, KindInvoice, input)
}

// CreateReceipt applies a receivable receipt.
func CreateReceipt(ctx context.Context, db *pgxpool.Pool, input DocumentInput) (*DocumentResult, error) {
	return CreateArapDocument(ctx, db, KindReceipt, input)
}

// CreateLoanIn records a loan received.
func CreateLoanIn(ctx context.Context, db *pgxpool.Pool, input DocumentInput) (*DocumentResult, error) {
	return CreateArapDocument(ctx, db, KindLoanIn, input)
}

// CreateLoanPayment pays down a loan payable.
func CreateLoanPayment(ctx context.Context, db *pgxpool.Pool, input DocumentInput) (*DocumentResult, error) {
	return CreateArapDocument(ctx, db, KindLoanPayment, input)
}

// ListOpenItems lists open items for a kind.
func ListOpenItems(ctx context.Context, db *pgxpool.Pool, orgID string, kind OpenItemKind) ([]OpenItemRow, error) {
	rows, err := db.Query(ctx, `
		SELECT id, type, contact_id, document_id, description,
			original_amount::text, balance_amount::text, due_date::text, status, created_at
		FROM open_items
		WHERE org_id = $1 AND type = $2
		ORDER BY due_date NULLS LAST, created_at
	`, orgID, string(kind))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []OpenItemRow{}
	for rows.Next() {
		var (
			row                   OpenItemRow
			origS, balS           string
			createdAt             time.Time
		)
		if err := rows.Scan(
			&row.ID, &row.Type, &row.ContactID, &row.DocumentID, &row.Description,
			&origS, &balS, &row.DueDate, &row.Status, &createdAt,
		); err != nil {
			return nil, err
		}
		row.OriginalAmount, _ = strconv.ParseFloat(origS, 64)
		row.BalanceAmount, _ = strconv.ParseFloat(balS, 64)
		row.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		items = append(items, row)
	}
	return items, rows.Err()
}

// GetAgingReport builds an aging report for open/partial items.
func GetAgingReport(ctx context.Context, db *pgxpool.Pool, orgID string, kind OpenItemKind) (*AgingReport, error) {
	today := time.Now()
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, today.Location())

	rows, err := db.Query(ctx, `
		SELECT oi.id, oi.contact_id, c.name, oi.description, oi.due_date::text, oi.balance_amount::text
		FROM open_items oi
		LEFT JOIN contacts c ON c.id = oi.contact_id
		WHERE oi.org_id = $1 AND oi.type = $2 AND oi.status IN ('open', 'partial')
	`, orgID, string(kind))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	buckets := AgingBucket{}
	items := []AgingRow{}

	for rows.Next() {
		var (
			id, description string
			contactID       *string
			contactName     *string
			dueDate         *string
			balS            string
		)
		if err := rows.Scan(&id, &contactID, &contactName, &description, &dueDate, &balS); err != nil {
			return nil, err
		}
		balance, _ := strconv.ParseFloat(balS, 64)
		if balance <= 0 {
			continue
		}

		bucket := "current"
		if dueDate != nil && *dueDate != "" {
			due, err := time.Parse("2006-01-02", *dueDate)
			if err == nil {
				diffDays := int(math.Floor(today.Sub(due).Hours() / 24))
				switch {
				case diffDays <= 0:
					bucket = "current"
				case diffDays <= 30:
					bucket = "days1to30"
				case diffDays <= 60:
					bucket = "days31to60"
				case diffDays <= 90:
					bucket = "days61to90"
				default:
					bucket = "days90plus"
				}
			}
		}

		switch bucket {
		case "current":
			buckets.Current += balance
		case "days1to30":
			buckets.Days1to30 += balance
		case "days31to60":
			buckets.Days31to60 += balance
		case "days61to90":
			buckets.Days61to90 += balance
		case "days90plus":
			buckets.Days90plus += balance
		}
		buckets.Total += balance

		items = append(items, AgingRow{
			ContactID:     contactID,
			ContactName:   contactName,
			OpenItemID:    id,
			Description:   description,
			DueDate:       dueDate,
			BalanceAmount: balance,
			Bucket:        bucket,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	buckets.Current = ledger.Round2(buckets.Current)
	buckets.Days1to30 = ledger.Round2(buckets.Days1to30)
	buckets.Days31to60 = ledger.Round2(buckets.Days31to60)
	buckets.Days61to90 = ledger.Round2(buckets.Days61to90)
	buckets.Days90plus = ledger.Round2(buckets.Days90plus)
	buckets.Total = ledger.Round2(buckets.Total)

	return &AgingReport{Kind: kind, Buckets: buckets, Items: items}, nil
}
