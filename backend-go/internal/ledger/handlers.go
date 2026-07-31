package ledger

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/icus/finbiz/backend-go/internal/audit"
	"github.com/icus/finbiz/backend-go/internal/auth"
	"github.com/icus/finbiz/backend-go/internal/billing"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes ledger HTTP routes.
type Service struct {
	db   *pgxpool.Pool
	auth *auth.Service
	bill *billing.Service
}

// NewService constructs a ledger service.
func NewService(db *pgxpool.Pool, authSvc *auth.Service, bill *billing.Service) *Service {
	return &Service{db: db, auth: authSvc, bill: bill}
}

func (s *Service) withOrg(r chi.Router) {
	r.Use(s.auth.RequireAuth, s.auth.RequireOrg)
}

// AccountsRoutes mounts at /api/accounts.
func (s *Service) AccountsRoutes() chi.Router {
	r := chi.NewRouter()
	s.withOrg(r)
	r.Get("/", s.listAccounts)
	r.Post("/", s.createAccount)
	r.Patch("/{id}", s.patchAccount)
	r.Get("/{id}/ledger", s.accountLedger)
	return r
}

// DocumentsRoutes mounts at /api/documents.
func (s *Service) DocumentsRoutes() chi.Router {
	r := chi.NewRouter()
	s.withOrg(r)
	r.Get("/", s.listDocuments)
	r.Post("/", s.createDocument)
	r.Get("/{id}", s.getDocument)
	return r
}

// JournalsRoutes mounts at /api/journals.
func (s *Service) JournalsRoutes() chi.Router {
	r := chi.NewRouter()
	s.withOrg(r)
	r.Get("/", s.listJournals)
	r.Post("/", s.createJournal)
	r.Get("/{id}", s.getJournal)
	r.Post("/{id}/void", s.voidJournal)
	return r
}

// PeriodsRoutes mounts at /api/periods.
func (s *Service) PeriodsRoutes() chi.Router {
	r := chi.NewRouter()
	s.withOrg(r)
	r.Get("/", s.listPeriods)
	r.Post("/close", s.closePeriod)
	return r
}

func (s *Service) listAccounts(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	rows, err := ListAccountsWithBalances(r.Context(), s.db, orgID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if rows == nil {
		rows = []AccountRow{}
	}
	platform.JSON(w, http.StatusOK, map[string]any{"accounts": rows})
}

type createAccountBody struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	IsCash *bool  `json:"isCash"`
}

func (s *Service) createAccount(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())
	var body createAccountBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" || body.Name == "" || body.Type == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid account body"))
		return
	}
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}

	var existing string
	err := s.db.QueryRow(r.Context(), `SELECT id FROM accounts WHERE org_id = $1 AND code = $2`, orgID, body.Code).Scan(&existing)
	if err == nil {
		platform.JSONError(w, platform.NewApiError(http.StatusConflict, "DUPLICATE_CODE", "Account code already exists"))
		return
	}
	if err != pgx.ErrNoRows {
		writeAPIError(w, err)
		return
	}

	isCash := false
	if body.IsCash != nil {
		isCash = *body.IsCash
	}

	var id, code, name, typ string
	var cash bool
	err = s.db.QueryRow(r.Context(), `
		INSERT INTO accounts (org_id, code, name, type, is_cash, is_system)
		VALUES ($1, $2, $3, $4, $5, false)
		RETURNING id, code, name, type, is_cash
	`, orgID, body.Code, body.Name, body.Type, isCash).Scan(&id, &code, &name, &typ, &cash)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	platform.JSON(w, http.StatusCreated, map[string]any{
		"account": map[string]any{
			"id": id, "code": code, "name": name, "type": typ, "isCash": cash, "balance": 0,
		},
	})
}

type patchAccountBody struct {
	Code *string `json:"code"`
	Name *string `json:"name"`
}

func (s *Service) patchAccount(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())
	accountID := chi.URLParam(r, "id")
	var body patchAccountBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Code == nil && body.Name == nil) {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "At least one field must be provided"))
		return
	}
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}

	var isSystem bool
	var curCode, curName, curType string
	var isCash bool
	err := s.db.QueryRow(r.Context(), `
		SELECT code, name, type, is_cash, is_system FROM accounts WHERE id = $1 AND org_id = $2
	`, accountID, orgID).Scan(&curCode, &curName, &curType, &isCash, &isSystem)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "ACCOUNT_NOT_FOUND", "Account not found"))
			return
		}
		writeAPIError(w, err)
		return
	}
	if isSystem {
		platform.JSONError(w, platform.NewApiError(http.StatusForbidden, "FORBIDDEN", "System accounts cannot be modified"))
		return
	}

	newCode, newName := curCode, curName
	if body.Code != nil {
		newCode = *body.Code
	}
	if body.Name != nil {
		newName = *body.Name
	}

	if newCode != curCode {
		var dup string
		err := s.db.QueryRow(r.Context(), `SELECT id FROM accounts WHERE org_id = $1 AND code = $2`, orgID, newCode).Scan(&dup)
		if err == nil {
			platform.JSONError(w, platform.NewApiError(http.StatusConflict, "DUPLICATE_CODE", "Account code already exists"))
			return
		}
		if err != pgx.ErrNoRows {
			writeAPIError(w, err)
			return
		}
	}

	var id, code, name, typ string
	var cash bool
	err = s.db.QueryRow(r.Context(), `
		UPDATE accounts SET code = $1, name = $2 WHERE id = $3
		RETURNING id, code, name, type, is_cash
	`, newCode, newName, accountID).Scan(&id, &code, &name, &typ, &cash)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"account": map[string]any{"id": id, "code": code, "name": name, "type": typ, "isCash": cash},
	})
}

func (s *Service) accountLedger(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	accountID := chi.URLParam(r, "id")
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")

	var accountType string
	err := s.db.QueryRow(r.Context(), `SELECT type FROM accounts WHERE id = $1 AND org_id = $2`, accountID, orgID).Scan(&accountType)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "ACCOUNT_NOT_FOUND", "Account not found"))
			return
		}
		writeAPIError(w, err)
		return
	}

	q := `
		SELECT jl.id, je.id, je.entry_date::text, je.description, jl.debit::text, jl.credit::text, jl.description
		FROM journal_lines jl
		INNER JOIN journal_entries je ON je.id = jl.entry_id
		WHERE jl.account_id = $1 AND je.org_id = $2 AND je.status = 'posted'
	`
	args := []any{accountID, orgID}
	argN := 3
	if from != "" {
		q += ` AND je.entry_date >= $` + strconv.Itoa(argN)
		args = append(args, from)
		argN++
	}
	if to != "" {
		q += ` AND je.entry_date <= $` + strconv.Itoa(argN)
		args = append(args, to)
		argN++
	}
	q += ` ORDER BY je.entry_date, jl.line_order`

	rows, err := s.db.Query(r.Context(), q, args...)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()

	var running float64
	type lineOut struct {
		ID          string  `json:"id"`
		EntryID     string  `json:"entryId"`
		EntryDate   string  `json:"entryDate"`
		Memo        string  `json:"memo"`
		Description *string `json:"description"`
		Debit       float64 `json:"debit"`
		Credit      float64 `json:"credit"`
		Balance     float64 `json:"balance"`
	}
	lines := []lineOut{}
	for rows.Next() {
		var (
			id, entryID, entryDate, memo string
			debitS, creditS              string
			lineDesc                     *string
		)
		if err := rows.Scan(&id, &entryID, &entryDate, &memo, &debitS, &creditS, &lineDesc); err != nil {
			writeAPIError(w, err)
			return
		}
		debit, _ := strconv.ParseFloat(debitS, 64)
		credit, _ := strconv.ParseFloat(creditS, 64)
		debit = math.Round(debit)
		credit = math.Round(credit)
		if accountType == "asset" || accountType == "expense" {
			running += debit - credit
		} else {
			running += credit - debit
		}
		lines = append(lines, lineOut{
			ID: id, EntryID: entryID, EntryDate: entryDate, Memo: memo,
			Description: lineDesc, Debit: debit, Credit: credit, Balance: running,
		})
	}
	platform.JSON(w, http.StatusOK, map[string]any{"lines": lines})
}

func (s *Service) listDocuments(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	contactID := r.URL.Query().Get("contactId")

	q := `
		SELECT id, type, number, status, date::text, due_date::text, total_amount::text, description, metadata, contact_id
		FROM documents WHERE org_id = $1`
	args := []any{orgID}
	if contactID != "" {
		q += ` AND contact_id = $2`
		args = append(args, contactID)
	}
	q += ` ORDER BY date DESC, created_at DESC`

	rows, err := s.db.Query(r.Context(), q, args...)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()

	docs := []DocumentAPI{}
	for rows.Next() {
		var id, typ, number, status, date, total string
		var dueDate *string
		var desc *string
		var meta []byte
		var contactIDCol *string
		if err := rows.Scan(&id, &typ, &number, &status, &date, &dueDate, &total, &desc, &meta, &contactIDCol); err != nil {
			writeAPIError(w, err)
			return
		}
		docs = append(docs, DocumentToAPIFull(id, typ, number, status, date, dueDate, total, desc, meta, contactIDCol))
	}
	platform.JSON(w, http.StatusOK, map[string]any{"documents": docs})
}

func (s *Service) getDocument(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	docID := chi.URLParam(r, "id")

	var id, typ, number, status, date, total string
	var dueDate *string
	var desc *string
	var meta []byte
	var contactIDCol *string
	err := s.db.QueryRow(r.Context(), `
		SELECT id, type, number, status, date::text, due_date::text, total_amount::text, description, metadata, contact_id
		FROM documents WHERE id = $1 AND org_id = $2
	`, docID, orgID).Scan(&id, &typ, &number, &status, &date, &dueDate, &total, &desc, &meta, &contactIDCol)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "DOCUMENT_NOT_FOUND", "Document not found"))
			return
		}
		writeAPIError(w, err)
		return
	}

	doc := DocumentToAPIFull(id, typ, number, status, date, dueDate, total, desc, meta, contactIDCol)

	var orgName string
	_ = s.db.QueryRow(r.Context(), `SELECT name FROM organizations WHERE id = $1`, orgID).Scan(&orgName)

	var contact any
	if contactIDCol != nil {
		var cid, name, kind string
		var email, phone, address, taxID *string
		err := s.db.QueryRow(r.Context(), `
			SELECT id, name, type, email, phone, address, tax_id FROM contacts WHERE id = $1 AND org_id = $2
		`, *contactIDCol, orgID).Scan(&cid, &name, &kind, &email, &phone, &address, &taxID)
		if err == nil {
			contact = map[string]any{
				"id": cid, "name": name, "kind": kind,
				"email": email, "phone": phone, "address": address, "taxId": taxID,
			}
		}
	}

	platform.JSON(w, http.StatusOK, map[string]any{
		"document": doc,
		"organization": map[string]any{
			"id":   orgID,
			"name": orgName,
		},
		"contact": contact,
	})
}

type createDocumentBody struct {
	Kind             string  `json:"kind"`
	Amount           float64 `json:"amount"`
	Memo             string  `json:"memo"`
	CashAccountID    string  `json:"cashAccountId"`
	CounterAccountID string  `json:"counterAccountId"`
	IsPrive          bool    `json:"isPrive"`
	Date             string  `json:"date"`
}

func (s *Service) createDocument(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())
	var body createDocumentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Kind == "" || body.Amount <= 0 {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid document body"))
		return
	}
	if err := s.bill.AssertEntitled(r.Context(), userID, string(billing.ActionPostJournal)); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}

	doc, err := CreateDocument(r.Context(), s.db, CreateDocumentInput{
		OrgID:            orgID,
		UserID:           userID,
		Kind:             DocumentKind(body.Kind),
		Amount:           body.Amount,
		Memo:             body.Memo,
		CashAccountID:    body.CashAccountID,
		CounterAccountID: body.CounterAccountID,
		IsPrive:          body.IsPrive,
		Date:             body.Date,
	})
	if err != nil {
		writeAPIError(w, err)
		return
	}
	audit.Log(r.Context(), s.db, orgID, userID, "document.created", "document", doc.ID, map[string]any{
		"kind": body.Kind, "amount": body.Amount,
	})
	platform.JSON(w, http.StatusCreated, map[string]any{"document": doc})
}

func (s *Service) listJournals(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	rows, err := s.db.Query(r.Context(), `
		SELECT id, entry_date::text, description, status
		FROM journal_entries WHERE org_id = $1
		ORDER BY entry_date DESC, created_at DESC
	`, orgID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()

	type entryOut struct {
		ID        string `json:"id"`
		EntryDate string `json:"entryDate"`
		Memo      string `json:"memo"`
		Status    string `json:"status"`
	}
	entries := []entryOut{}
	for rows.Next() {
		var e entryOut
		var status string
		if err := rows.Scan(&e.ID, &e.EntryDate, &e.Memo, &status); err != nil {
			writeAPIError(w, err)
			return
		}
		e.Status = mapJournalStatus(status)
		entries = append(entries, e)
	}
	platform.JSON(w, http.StatusOK, map[string]any{"entries": entries})
}

type journalLineBody struct {
	AccountID   string  `json:"accountId"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Description string  `json:"description"`
}

type createJournalBody struct {
	Date        string           `json:"date"`
	Description string           `json:"description"`
	Lines       []journalLineBody `json:"lines"`
}

func (s *Service) createJournal(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())

	var body createJournalBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body"))
		return
	}
	desc := strings.TrimSpace(body.Description)
	if desc == "" {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "description is required"))
		return
	}
	if len(body.Lines) < 2 {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "At least two lines are required"))
		return
	}

	entryDate := time.Now().UTC()
	if body.Date != "" {
		if !dateRe.MatchString(body.Date) {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "date must be YYYY-MM-DD"))
			return
		}
		t, err := time.Parse("2006-01-02", body.Date)
		if err != nil {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "Invalid date"))
			return
		}
		entryDate = t
	}

	if err := s.bill.AssertEntitled(r.Context(), userID, string(billing.ActionPostJournal)); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}

	lines := make([]JournalLineInput, 0, len(body.Lines))
	for _, l := range body.Lines {
		if l.AccountID == "" {
			platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "accountId is required on each line"))
			return
		}
		lines = append(lines, JournalLineInput{
			AccountID:   l.AccountID,
			Debit:       l.Debit,
			Credit:      l.Credit,
			Description: l.Description,
		})
	}

	entryID, err := PostJournal(r.Context(), s.db, PostJournalInput{
		OrgID:       orgID,
		Date:        entryDate,
		Description: desc,
		UserID:      &userID,
		Lines:       lines,
	})
	if err != nil {
		writeAPIError(w, err)
		return
	}

	audit.Log(r.Context(), s.db, orgID, userID, "journal.posted", "journal_entry", entryID, map[string]any{
		"description": desc, "lineCount": len(lines),
	})
	platform.JSON(w, http.StatusCreated, map[string]any{
		"entry": map[string]any{
			"id": entryID, "entryDate": entryDate.Format("2006-01-02"),
			"memo": desc, "status": "posted",
		},
	})
}

func (s *Service) getJournal(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	entryID := chi.URLParam(r, "id")

	var (
		id, entryDate, memo, status string
		documentID                  *string
		postedAt, voidedAt          *time.Time
	)
	err := s.db.QueryRow(r.Context(), `
		SELECT id, entry_date::text, description, status, document_id, posted_at, voided_at
		FROM journal_entries WHERE id = $1 AND org_id = $2
	`, entryID, orgID).Scan(&id, &entryDate, &memo, &status, &documentID, &postedAt, &voidedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			platform.JSONError(w, platform.NewApiError(http.StatusNotFound, "JOURNAL_NOT_FOUND", "Journal entry not found"))
			return
		}
		writeAPIError(w, err)
		return
	}

	rows, err := s.db.Query(r.Context(), `
		SELECT jl.id, jl.account_id, a.code, a.name, jl.debit::text, jl.credit::text, jl.description, jl.line_order
		FROM journal_lines jl
		INNER JOIN accounts a ON a.id = jl.account_id
		WHERE jl.entry_id = $1
		ORDER BY jl.line_order
	`, entryID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()

	type lineOut struct {
		ID          string  `json:"id"`
		AccountID   string  `json:"accountId"`
		AccountCode string  `json:"accountCode"`
		AccountName string  `json:"accountName"`
		Debit       float64 `json:"debit"`
		Credit      float64 `json:"credit"`
		Description *string `json:"description"`
		LineOrder   int     `json:"lineOrder"`
	}
	lines := []lineOut{}
	for rows.Next() {
		var l lineOut
		var debitS, creditS string
		if err := rows.Scan(&l.ID, &l.AccountID, &l.AccountCode, &l.AccountName, &debitS, &creditS, &l.Description, &l.LineOrder); err != nil {
			writeAPIError(w, err)
			return
		}
		d, _ := strconv.ParseFloat(debitS, 64)
		c, _ := strconv.ParseFloat(creditS, 64)
		l.Debit = math.Round(d)
		l.Credit = math.Round(c)
		lines = append(lines, l)
	}

	var postedAtS, voidedAtS *string
	if postedAt != nil {
		s := postedAt.UTC().Format(time.RFC3339Nano)
		postedAtS = &s
	}
	if voidedAt != nil {
		s := voidedAt.UTC().Format(time.RFC3339Nano)
		voidedAtS = &s
	}

	platform.JSON(w, http.StatusOK, map[string]any{
		"entry": map[string]any{
			"id": id, "entryDate": entryDate, "memo": memo,
			"status": mapJournalStatus(status), "documentId": documentID,
			"postedAt": postedAtS, "voidedAt": voidedAtS,
		},
		"lines": lines,
	})
}

func (s *Service) voidJournal(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())
	entryID := chi.URLParam(r, "id")
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := VoidJournal(r.Context(), s.db, entryID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}
	audit.Log(r.Context(), s.db, orgID, userID, "journal.voided", "journal_entry", entryID, nil)
	platform.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) listPeriods(w http.ResponseWriter, r *http.Request) {
	orgID, _ := platform.OrgID(r.Context())
	rows, err := s.db.Query(r.Context(), `
		SELECT id, name, start_date::text, end_date::text, is_closed
		FROM fiscal_periods WHERE org_id = $1
		ORDER BY end_date DESC
	`, orgID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()

	type periodOut struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		StartDate string `json:"startDate"`
		EndDate   string `json:"endDate"`
		IsClosed  bool   `json:"isClosed"`
	}
	periods := []periodOut{}
	for rows.Next() {
		var p periodOut
		if err := rows.Scan(&p.ID, &p.Name, &p.StartDate, &p.EndDate, &p.IsClosed); err != nil {
			writeAPIError(w, err)
			return
		}
		periods = append(periods, p)
	}
	platform.JSON(w, http.StatusOK, map[string]any{"periods": periods})
}

type closePeriodBody struct {
	EndDate string `json:"endDate"`
}

func (s *Service) closePeriod(w http.ResponseWriter, r *http.Request) {
	userID, _ := platform.UserID(r.Context())
	orgID, _ := platform.OrgID(r.Context())
	var body closePeriodBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !dateRe.MatchString(body.EndDate) {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "VALIDATION_ERROR", "endDate must be YYYY-MM-DD"))
		return
	}
	if err := s.bill.AssertWritable(r.Context(), userID, orgID); err != nil {
		writeAPIError(w, err)
		return
	}

	var lastEnd *string
	err := s.db.QueryRow(r.Context(), `
		SELECT end_date::text FROM fiscal_periods WHERE org_id = $1 ORDER BY end_date DESC LIMIT 1
	`, orgID).Scan(&lastEnd)
	if err != nil && err != pgx.ErrNoRows {
		writeAPIError(w, err)
		return
	}

	startDate := body.EndDate[:4] + "-01-01"
	if lastEnd != nil && *lastEnd != "" {
		startDate = *lastEnd
	}
	if body.EndDate < startDate {
		platform.JSONError(w, platform.NewApiError(http.StatusBadRequest, "INVALID_PERIOD", "End date must be after period start"))
		return
	}

	name := "Period " + startDate + " — " + body.EndDate
	netIncome, err := getPeriodNetIncome(r.Context(), s.db, orgID, startDate, body.EndDate)
	if err != nil {
		writeAPIError(w, err)
		return
	}

	var closingJournalID *string
	if math.Abs(netIncome) > 0.001 {
		var retainedID, revenueID, expenseID string
		_ = s.db.QueryRow(r.Context(), `SELECT id FROM accounts WHERE org_id = $1 AND code = '3300'`, orgID).Scan(&retainedID)
		_ = s.db.QueryRow(r.Context(), `SELECT id FROM accounts WHERE org_id = $1 AND code = '4100'`, orgID).Scan(&revenueID)
		_ = s.db.QueryRow(r.Context(), `SELECT id FROM accounts WHERE org_id = $1 AND code = '5100'`, orgID).Scan(&expenseID)

		endTime, _ := time.Parse("2006-01-02", body.EndDate)
		if retainedID != "" && revenueID != "" && expenseID != "" && netIncome > 0 {
			id, err := PostJournal(r.Context(), s.db, PostJournalInput{
				OrgID: orgID, Date: endTime, Description: "Closing entries — " + name, UserID: &userID,
				Lines: []JournalLineInput{
					{AccountID: revenueID, Debit: netIncome},
					{AccountID: retainedID, Credit: netIncome},
				},
			})
			if err == nil {
				closingJournalID = &id
			}
		} else if retainedID != "" && revenueID != "" && expenseID != "" && netIncome < 0 {
			loss := -netIncome
			id, err := PostJournal(r.Context(), s.db, PostJournalInput{
				OrgID: orgID, Date: endTime, Description: "Closing entries (loss) — " + name, UserID: &userID,
				Lines: []JournalLineInput{
					{AccountID: retainedID, Debit: loss},
					{AccountID: expenseID, Credit: loss},
				},
			})
			if err == nil {
				closingJournalID = &id
			}
		}
	}

	var id, pName, pStart, pEnd string
	var isClosed bool
	err = s.db.QueryRow(r.Context(), `
		INSERT INTO fiscal_periods (org_id, name, start_date, end_date, is_closed)
		VALUES ($1, $2, $3, $4, true)
		RETURNING id, name, start_date::text, end_date::text, is_closed
	`, orgID, name, startDate, body.EndDate).Scan(&id, &pName, &pStart, &pEnd, &isClosed)
	if err != nil {
		writeAPIError(w, err)
		return
	}

	audit.Log(r.Context(), s.db, orgID, userID, "period.closed", "fiscal_period", id, map[string]any{
		"endDate": body.EndDate, "netIncome": netIncome,
	})
	platform.JSON(w, http.StatusOK, map[string]any{
		"period": map[string]any{
			"id": id, "name": pName, "startDate": pStart, "endDate": pEnd, "isClosed": isClosed,
		},
		"closingJournalId": closingJournalID,
		"netIncome":        netIncome,
	})
}

func getPeriodNetIncome(ctx context.Context, db *pgxpool.Pool, orgID, from, to string) (float64, error) {
	rows, err := db.Query(ctx, `
		SELECT a.type,
			coalesce(sum(jl.debit::numeric), 0),
			coalesce(sum(jl.credit::numeric), 0)
		FROM journal_lines jl
		INNER JOIN journal_entries je ON jl.entry_id = je.id
		INNER JOIN accounts a ON jl.account_id = a.id
		WHERE je.org_id = $1 AND je.status = 'posted'
			AND je.entry_date >= $2 AND je.entry_date <= $3
			AND a.type IN ('revenue', 'expense')
		GROUP BY a.type
	`, orgID, from, to)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var revenue, expense float64
	for rows.Next() {
		var typ string
		var debit, credit float64
		if err := rows.Scan(&typ, &debit, &credit); err != nil {
			return 0, err
		}
		if typ == "revenue" {
			revenue += credit - debit
		} else if typ == "expense" {
			expense += debit - credit
		}
	}
	return revenue - expense, rows.Err()
}
