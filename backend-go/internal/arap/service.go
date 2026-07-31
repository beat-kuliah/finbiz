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
	IsMonthly     bool
	Complete      bool // when true on receipt: pay full remaining balance
}

// DocumentResult is the ARAP document API shape.
type DocumentResult struct {
	ID            string  `json:"id"`
	Kind          string  `json:"kind"`
	Status        string  `json:"status"`
	Date          string  `json:"date"`
	DueDate       *string `json:"dueDate,omitempty"`
	Number        string  `json:"number,omitempty"`
	Amount        float64 `json:"amount"`
	Memo          string  `json:"memo"`
	IsMonthly     bool    `json:"isMonthly,omitempty"`
	OpenItemID    *string `json:"openItemId,omitempty"`
	NextInvoiceID *string `json:"nextInvoiceId,omitempty"`
}

// OpenItemRow is a listed open item.
type OpenItemRow struct {
	ID             string  `json:"id"`
	Type           string  `json:"type"`
	ContactID      *string `json:"contactId"`
	DocumentID     *string `json:"documentId"`
	DocumentNumber *string `json:"documentNumber,omitempty"`
	Description    string  `json:"description"`
	OriginalAmount float64 `json:"originalAmount"`
	BalanceAmount  float64 `json:"balanceAmount"`
	DueDate        *string `json:"dueDate"`
	Status         string  `json:"status"`
	IsMonthly      bool    `json:"isMonthly"`
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

func reduceOpenItem(ctx context.Context, tx pgx.Tx, item *openItemRecord, paymentAmount float64) (newBalance float64, status string, err error) {
	if paymentAmount > item.BalanceAmount+0.01 {
		return 0, "", platform.NewApiError(http.StatusBadRequest, "INVALID_AMOUNT",
			"Payment exceeds open item balance")
	}
	newBalance = ledger.Round2(item.BalanceAmount - paymentAmount)
	if newBalance < 0 {
		newBalance = 0
	}
	status = updateOpenItemStatus(newBalance, item.OriginalAmount)
	_, err = tx.Exec(ctx, `
		UPDATE open_items SET balance_amount = $1, status = $2 WHERE id = $3
	`, formatAmt(newBalance), status, item.ID)
	return newBalance, status, err
}

// addMonths keeps the same day-of-month when possible (clamps to last day).
func addMonths(dateStr string, months int) (string, error) {
	t, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return "", err
	}
	day := t.Day()
	first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, months, 0)
	lastDay := time.Date(first.Year(), first.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if day > lastDay {
		day = lastDay
	}
	return time.Date(first.Year(), first.Month(), day, 0, 0, 0, 0, time.UTC).Format("2006-01-02"), nil
}

func metaBool(m map[string]any, key string) bool {
	v, ok := m[key]
	if !ok {
		return false
	}
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true") || t == "1"
	default:
		return false
	}
}

type invoiceRenewalSource struct {
	Amount    float64
	Memo      string
	ContactID *string
	Date      string
	DueDate   *string
	IsMonthly bool
	Active    bool
}

func loadInvoiceRenewal(ctx context.Context, tx pgx.Tx, orgID, documentID string) (*invoiceRenewalSource, error) {
	var (
		totalS string
		desc   *string
		date   string
		due    *string
		cid    *string
		meta   []byte
	)
	err := tx.QueryRow(ctx, `
		SELECT total_amount::text, description, date::text, due_date::text, contact_id, metadata
		FROM documents
		WHERE id = $1 AND org_id = $2 AND type = 'invoice'
	`, documentID, orgID).Scan(&totalS, &desc, &date, &due, &cid, &meta)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	amount, _ := strconv.ParseFloat(totalS, 64)
	memo := ""
	if desc != nil {
		memo = *desc
	}
	src := &invoiceRenewalSource{
		Amount:    amount,
		Memo:      memo,
		ContactID: cid,
		Date:      date,
		DueDate:   due,
	}
	if len(meta) > 0 {
		var m map[string]any
		if json.Unmarshal(meta, &m) == nil {
			src.IsMonthly = metaBool(m, "isMonthly")
			if _, ok := m["monthlyActive"]; ok {
				src.Active = metaBool(m, "monthlyActive")
			} else {
				src.Active = src.IsMonthly
			}
		}
	}
	return src, nil
}

func createRenewalInvoice(
	ctx context.Context,
	tx pgx.Tx,
	db *pgxpool.Pool,
	orgID, userID string,
	src *invoiceRenewalSource,
	piutangID, pendapatanID string,
) (string, error) {
	nextDate, err := addMonths(src.Date, 1)
	if err != nil {
		return "", err
	}
	var nextDue *string
	if src.DueDate != nil && *src.DueDate != "" {
		d, err := addMonths(*src.DueDate, 1)
		if err != nil {
			return "", err
		}
		nextDue = &d
	} else {
		d, err := addMonths(src.Date, 1)
		if err != nil {
			return "", err
		}
		nextDue = &d
	}

	memo := src.Memo
	if memo == "" {
		memo = defaultMemo(KindInvoice)
	}

	number, err := ledger.NextDocumentNumber(ctx, tx, orgID, ledger.DocInvoice)
	if err != nil {
		return "", err
	}

	meta := map[string]any{
		"kind":          string(KindInvoice),
		"isMonthly":     true,
		"monthlyActive": true,
	}
	metaBytes, _ := json.Marshal(meta)

	var docID string
	err = tx.QueryRow(ctx, `
		INSERT INTO documents (org_id, type, number, contact_id, date, due_date, status, description, total_amount, metadata)
		VALUES ($1, 'invoice', $2, $3, $4, $5, 'posted', $6, $7, $8)
		RETURNING id
	`, orgID, number, src.ContactID, nextDate, nextDue, memo, formatAmt(src.Amount), metaBytes,
	).Scan(&docID)
	if err != nil {
		return "", err
	}

	entryDate, err := time.Parse("2006-01-02", nextDate)
	if err != nil {
		return "", platform.NewApiError(http.StatusBadRequest, "INVALID_DATE", "Date must be YYYY-MM-DD")
	}
	uid := userID
	_, err = ledger.PostJournal(ctx, db, ledger.PostJournalInput{
		OrgID:       orgID,
		Date:        entryDate,
		Description: memo,
		Lines: []ledger.JournalLineInput{
			{AccountID: piutangID, Debit: src.Amount},
			{AccountID: pendapatanID, Credit: src.Amount},
		},
		DocumentID: &docID,
		UserID:     &uid,
		Tx:         tx,
	})
	if err != nil {
		return "", err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO open_items (org_id, type, contact_id, document_id, description,
			original_amount, balance_amount, due_date, status)
		VALUES ($1, 'receivable', $2, $3, $4, $5, $6, $7, 'open')
	`, orgID, src.ContactID, docID, memo, formatAmt(src.Amount), formatAmt(src.Amount), nextDue)
	if err != nil {
		return "", err
	}
	return docID, nil
}

// CreateArapDocument creates an invoice, receipt, loan_in, or loan_payment.
func CreateArapDocument(ctx context.Context, db *pgxpool.Pool, kind DocumentKind, input DocumentInput) (*DocumentResult, error) {
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

	amount := input.Amount
	if input.Complete && openItemToReduce != nil {
		amount = openItemToReduce.BalanceAmount
	}
	amount, err = ledger.ParseAmount(amount)
	if err != nil {
		return nil, err
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
		parsedDue, err := ledger.ParseDate(input.DueDate)
		if err != nil {
			return nil, err
		}
		dueDate = &parsedDue
	}

	meta := map[string]any{"kind": string(kind)}
	if kind == KindInvoice && input.IsMonthly {
		meta["isMonthly"] = true
		meta["monthlyActive"] = true
	}
	if input.OpenItemID != "" {
		meta["openItemId"] = input.OpenItemID
	}
	if input.DocumentID != "" {
		meta["sourceDocumentId"] = input.DocumentID
	}
	if openItemToReduce != nil && openItemToReduce.DocumentID != nil {
		meta["sourceDocumentId"] = *openItemToReduce.DocumentID
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

	var nextInvoiceID *string
	if openItemToReduce != nil {
		newBal, itemStatus, err := reduceOpenItem(ctx, tx, openItemToReduce, amount)
		if err != nil {
			return nil, err
		}
		_ = newBal
		openItemID = &openItemToReduce.ID

		if kind == KindReceipt && itemStatus == "closed" && openItemToReduce.DocumentID != nil {
			src, err := loadInvoiceRenewal(ctx, tx, input.OrgID, *openItemToReduce.DocumentID)
			if err != nil {
				return nil, err
			}
			if src != nil && src.IsMonthly && src.Active {
				nid, err := createRenewalInvoice(ctx, tx, db, input.OrgID, input.UserID, src, piutangID, pendapatanID)
				if err != nil {
					return nil, err
				}
				nextInvoiceID = &nid
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	outMemo := ""
	if docDesc != nil {
		outMemo = *docDesc
	}
	return &DocumentResult{
		ID:            docID,
		Kind:          string(kind),
		Status:        status,
		Date:          docDate,
		DueDate:       dueDate,
		Number:        number,
		Amount:        math.Round(amount),
		Memo:          outMemo,
		IsMonthly:     kind == KindInvoice && input.IsMonthly,
		OpenItemID:    openItemID,
		NextInvoiceID: nextInvoiceID,
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

// ListOpenItems lists open items for a kind, optionally filtered by contactID.
func ListOpenItems(ctx context.Context, db *pgxpool.Pool, orgID string, kind OpenItemKind, contactID string) ([]OpenItemRow, error) {
	q := `
		SELECT oi.id, oi.type, oi.contact_id, oi.document_id, d.number, oi.description,
			oi.original_amount::text, oi.balance_amount::text, oi.due_date::text, oi.status,
			d.metadata, oi.created_at
		FROM open_items oi
		LEFT JOIN documents d ON d.id = oi.document_id
		WHERE oi.org_id = $1 AND oi.type = $2`
	args := []any{orgID, string(kind)}
	if contactID != "" {
		q += ` AND oi.contact_id = $3`
		args = append(args, contactID)
	}
	q += ` ORDER BY oi.due_date NULLS LAST, oi.created_at`

	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []OpenItemRow{}
	for rows.Next() {
		var (
			row         OpenItemRow
			origS, balS string
			meta        []byte
			createdAt   time.Time
		)
		if err := rows.Scan(
			&row.ID, &row.Type, &row.ContactID, &row.DocumentID, &row.DocumentNumber, &row.Description,
			&origS, &balS, &row.DueDate, &row.Status, &meta, &createdAt,
		); err != nil {
			return nil, err
		}
		row.OriginalAmount, _ = strconv.ParseFloat(origS, 64)
		row.BalanceAmount, _ = strconv.ParseFloat(balS, 64)
		row.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		if len(meta) > 0 {
			var m map[string]any
			if json.Unmarshal(meta, &m) == nil {
				row.IsMonthly = metaBool(m, "isMonthly")
			}
		}
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
