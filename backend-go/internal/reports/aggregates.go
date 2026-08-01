package reports

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DashboardMetrics matches the TS dashboard payload.
type DashboardMetrics struct {
	Cash            float64 `json:"cash"`
	PeriodRevenue   float64 `json:"periodRevenue"`
	PeriodNetIncome float64 `json:"periodNetIncome"`
	Receivables     float64 `json:"receivables"`
	Payables        float64 `json:"payables"`
	Equity          float64 `json:"equity"`
}

// DateRange is an optional period filter.
type DateRange struct {
	From string
	To   string
}

type accountBalance struct {
	AccountID string
	Code      string
	Name      string
	Type      string
	IsCash    bool
	Debit     float64
	Credit    float64
	Balance   float64
}

func toNum(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

func round2(n float64) float64 {
	return math.Round(n*100) / 100
}

func defaultPeriod() (from, to string) {
	now := time.Now().UTC()
	from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
	to = now.Format("2006-01-02")
	return from, to
}

func balanceForType(accountType string, debit, credit float64) float64 {
	if accountType == "asset" || accountType == "expense" {
		return debit - credit
	}
	return credit - debit
}

func accountBalances(ctx context.Context, db *pgxpool.Pool, orgID string, asOf string) ([]accountBalance, error) {
	query := `
		SELECT a.id, a.code, a.name, a.type, a.is_cash,
			coalesce(sum(jl.debit::numeric), 0),
			coalesce(sum(jl.credit::numeric), 0)
		FROM journal_lines jl
		INNER JOIN journal_entries je ON jl.entry_id = je.id
		INNER JOIN accounts a ON jl.account_id = a.id
		WHERE je.org_id = $1 AND je.status = 'posted'`
	args := []any{orgID}
	if asOf != "" {
		query += ` AND je.entry_date <= $2`
		args = append(args, asOf)
	}
	query += `
		GROUP BY a.id, a.code, a.name, a.type, a.is_cash`

	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []accountBalance
	for rows.Next() {
		var b accountBalance
		if err := rows.Scan(&b.AccountID, &b.Code, &b.Name, &b.Type, &b.IsCash, &b.Debit, &b.Credit); err != nil {
			return nil, err
		}
		b.Debit = toNum(b.Debit)
		b.Credit = toNum(b.Credit)
		b.Balance = balanceForType(b.Type, b.Debit, b.Credit)
		out = append(out, b)
	}
	return out, rows.Err()
}

func periodActivity(ctx context.Context, db *pgxpool.Pool, orgID, from, to string) (periodRevenue, periodExpense, periodNetIncome float64, err error) {
	rows, err := db.Query(ctx, `
		SELECT a.type,
			coalesce(sum(jl.debit::numeric), 0),
			coalesce(sum(jl.credit::numeric), 0)
		FROM journal_lines jl
		INNER JOIN journal_entries je ON jl.entry_id = je.id
		INNER JOIN accounts a ON jl.account_id = a.id
		WHERE je.org_id = $1 AND je.status = 'posted'
			AND je.entry_date >= $2 AND je.entry_date <= $3
		GROUP BY a.type
	`, orgID, from, to)
	if err != nil {
		return 0, 0, 0, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			typ            string
			debit, credit  float64
		)
		if err := rows.Scan(&typ, &debit, &credit); err != nil {
			return 0, 0, 0, err
		}
		debit, credit = toNum(debit), toNum(credit)
		switch typ {
		case "revenue":
			periodRevenue += credit - debit
		case "expense":
			periodExpense += debit - credit
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, 0, err
	}
	return periodRevenue, periodExpense, periodRevenue - periodExpense, nil
}

// GetDashboardMetrics returns cash, P&L period metrics, AR/AP, and equity.
func GetDashboardMetrics(ctx context.Context, db *pgxpool.Pool, orgID string, range_ *DateRange) (*DashboardMetrics, error) {
	from, to := defaultPeriod()
	if range_ != nil && range_.From != "" && range_.To != "" {
		from, to = range_.From, range_.To
	}

	balances, err := accountBalances(ctx, db, orgID, to)
	if err != nil {
		return nil, err
	}
	periodRevenue, _, periodNetIncome, err := periodActivity(ctx, db, orgID, from, to)
	if err != nil {
		return nil, err
	}

	var cash float64
	for _, a := range balances {
		if a.IsCash {
			cash += a.Balance
		}
	}

	receivables, err := sumOpenItems(ctx, db, orgID, "receivable")
	if err != nil {
		return nil, err
	}
	payables, err := sumOpenItems(ctx, db, orgID, "payable")
	if err != nil {
		return nil, err
	}

	if receivables == 0 {
		for _, a := range balances {
			if a.Type == "asset" && strings.HasPrefix(a.Code, "13") {
				receivables += a.Balance
			}
		}
	}
	if payables == 0 {
		for _, a := range balances {
			if a.Type == "liability" && strings.HasPrefix(a.Code, "21") {
				payables += a.Balance
			}
		}
	}

	var equityAccounts, allTimeRevenue, allTimeExpense float64
	for _, a := range balances {
		switch a.Type {
		case "equity":
			equityAccounts += a.Balance
		case "revenue":
			allTimeRevenue += a.Balance
		case "expense":
			allTimeExpense += a.Balance
		}
	}

	return &DashboardMetrics{
		Cash:            cash,
		PeriodRevenue:   periodRevenue,
		PeriodNetIncome: periodNetIncome,
		Receivables:     receivables,
		Payables:        payables,
		Equity:          equityAccounts + (allTimeRevenue - allTimeExpense),
	}, nil
}

func sumOpenItems(ctx context.Context, db *pgxpool.Pool, orgID, itemType string) (float64, error) {
	var sum float64
	err := db.QueryRow(ctx, `
		SELECT coalesce(sum(balance_amount::numeric), 0)
		FROM open_items WHERE org_id = $1 AND type = $2
	`, orgID, itemType).Scan(&sum)
	return toNum(sum), err
}

// GetProfitLoss returns period P&L totals, optionally with account breakdown.
func GetProfitLoss(ctx context.Context, db *pgxpool.Pool, orgID, from, to string, breakdown bool) (map[string]any, error) {
	rows, err := db.Query(ctx, `
		SELECT a.id, a.code, a.name, a.type,
			coalesce(sum(jl.debit::numeric), 0),
			coalesce(sum(jl.credit::numeric), 0)
		FROM journal_lines jl
		INNER JOIN journal_entries je ON jl.entry_id = je.id
		INNER JOIN accounts a ON jl.account_id = a.id
		WHERE je.org_id = $1 AND je.status = 'posted'
			AND je.entry_date >= $2 AND je.entry_date <= $3
			AND a.type IN ('revenue', 'expense')
		GROUP BY a.id, a.code, a.name, a.type
	`, orgID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var totalRevenue, totalExpense float64
	var items []map[string]any
	for rows.Next() {
		var (
			id, code, name, typ string
			debit, credit       float64
		)
		if err := rows.Scan(&id, &code, &name, &typ, &debit, &credit); err != nil {
			return nil, err
		}
		debit, credit = toNum(debit), toNum(credit)
		var amount float64
		if typ == "revenue" {
			amount = credit - debit
			totalRevenue += amount
		} else {
			amount = debit - credit
			totalExpense += amount
		}
		if breakdown {
			items = append(items, map[string]any{
				"accountId": id,
				"code":      code,
				"name":      name,
				"type":      typ,
				"amount":    amount,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := map[string]any{
		"totalRevenue": totalRevenue,
		"totalExpense": totalExpense,
		"netIncome":    totalRevenue - totalExpense,
	}
	if breakdown {
		if items == nil {
			items = []map[string]any{}
		}
		out["breakdown"] = items
	}
	return out, nil
}

// GetBalanceSheet returns assets, liabilities, and equity including net income.
func GetBalanceSheet(ctx context.Context, db *pgxpool.Pool, orgID, asOf string) (map[string]any, error) {
	date := asOf
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}
	balances, err := accountBalances(ctx, db, orgID, date)
	if err != nil {
		return nil, err
	}

	var totalAssets, totalLiabilities, equityAccounts, revenue, expense float64
	for _, a := range balances {
		switch a.Type {
		case "asset":
			totalAssets += a.Balance
		case "liability":
			totalLiabilities += a.Balance
		case "equity":
			equityAccounts += a.Balance
		case "revenue":
			revenue += a.Balance
		case "expense":
			expense += a.Balance
		}
	}

	return map[string]any{
		"asOf":             date,
		"totalAssets":      totalAssets,
		"totalLiabilities": totalLiabilities,
		"equityWithIncome": equityAccounts + (revenue - expense),
	}, nil
}

// GetTrialBalance returns debit/credit totals per account as of a date.
func GetTrialBalance(ctx context.Context, db *pgxpool.Pool, orgID, asOf string) (map[string]any, error) {
	date := asOf
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}

	rows, err := db.Query(ctx, `
		SELECT a.id, a.code, a.name,
			coalesce(sum(jl.debit::numeric), 0),
			coalesce(sum(jl.credit::numeric), 0)
		FROM journal_lines jl
		INNER JOIN journal_entries je ON jl.entry_id = je.id
		INNER JOIN accounts a ON jl.account_id = a.id
		WHERE je.org_id = $1 AND je.status = 'posted' AND je.entry_date <= $2
		GROUP BY a.id, a.code, a.name
		ORDER BY a.code
	`, orgID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var totalDebit, totalCredit float64
	accountsList := []map[string]any{}
	for rows.Next() {
		var (
			id, code, name  string
			debit, credit   float64
		)
		if err := rows.Scan(&id, &code, &name, &debit, &credit); err != nil {
			return nil, err
		}
		debit, credit = toNum(debit), toNum(credit)
		totalDebit += debit
		totalCredit += credit
		accountsList = append(accountsList, map[string]any{
			"accountId": id,
			"code":      code,
			"name":      name,
			"debit":     debit,
			"credit":    credit,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"asOf":        date,
		"totalDebit":  totalDebit,
		"totalCredit": totalCredit,
		"accounts":    accountsList,
	}, nil
}

// GetCashFlow returns cash in/out for the period from cash accounts.
func GetCashFlow(ctx context.Context, db *pgxpool.Pool, orgID, from, to string) (map[string]any, error) {
	rows, err := db.Query(ctx, `
		SELECT id FROM accounts WHERE org_id = $1 AND is_cash = true
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cashIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		cashIDs = append(cashIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(cashIDs) == 0 {
		return map[string]any{
			"from": from, "to": to,
			"cashIn": 0, "cashOut": 0, "netCashFlow": 0,
		}, nil
	}

	var debit, credit float64
	err = db.QueryRow(ctx, `
		SELECT coalesce(sum(jl.debit::numeric), 0), coalesce(sum(jl.credit::numeric), 0)
		FROM journal_lines jl
		INNER JOIN journal_entries je ON jl.entry_id = je.id
		WHERE je.org_id = $1 AND je.status = 'posted'
			AND je.entry_date >= $2 AND je.entry_date <= $3
			AND jl.account_id = ANY($4)
	`, orgID, from, to, cashIDs).Scan(&debit, &credit)
	if err != nil {
		return nil, err
	}
	cashIn, cashOut := toNum(debit), toNum(credit)
	return map[string]any{
		"from": from, "to": to,
		"cashIn": cashIn, "cashOut": cashOut, "netCashFlow": cashIn - cashOut,
	}, nil
}

// AgingBucket holds AR/AP aging totals.
type AgingBucket struct {
	Current    float64 `json:"current"`
	Days1to30  float64 `json:"days1to30"`
	Days31to60 float64 `json:"days31to60"`
	Days61to90 float64 `json:"days61to90"`
	Days90Plus float64 `json:"days90plus"`
	Total      float64 `json:"total"`
}

// GetAgingReport duplicates AR/AP aging SQL (avoids circular import with arap).
func GetAgingReport(ctx context.Context, db *pgxpool.Pool, orgID, kind string) (map[string]any, error) {
	if kind != "payable" {
		kind = "receivable"
	}
	today := time.Now().UTC().Truncate(24 * time.Hour)

	rows, err := db.Query(ctx, `
		SELECT oi.id, oi.contact_id, c.name, oi.description, oi.due_date, oi.balance_amount::numeric
		FROM open_items oi
		LEFT JOIN contacts c ON oi.contact_id = c.id
		WHERE oi.org_id = $1 AND oi.type = $2 AND oi.status IN ('open', 'partial')
	`, orgID, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	buckets := AgingBucket{}
	items := []map[string]any{}

	for rows.Next() {
		var (
			id, description     string
			contactID           *string
			contactName         *string
			dueDate             *time.Time
			balance             float64
		)
		if err := rows.Scan(&id, &contactID, &contactName, &description, &dueDate, &balance); err != nil {
			return nil, err
		}
		balance = toNum(balance)
		if balance <= 0 {
			continue
		}

		bucket := "current"
		if dueDate != nil {
			due := time.Date(dueDate.Year(), dueDate.Month(), dueDate.Day(), 0, 0, 0, 0, time.UTC)
			diffDays := int(today.Sub(due).Hours() / 24)
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
			buckets.Days90Plus += balance
		}
		buckets.Total += balance

		var dueStr any
		if dueDate != nil {
			dueStr = dueDate.Format("2006-01-02")
		} else {
			dueStr = nil
		}
		items = append(items, map[string]any{
			"contactId":     contactID,
			"contactName":   contactName,
			"openItemId":    id,
			"description":   description,
			"dueDate":       dueStr,
			"balanceAmount": balance,
			"bucket":        bucket,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	buckets.Current = round2(buckets.Current)
	buckets.Days1to30 = round2(buckets.Days1to30)
	buckets.Days31to60 = round2(buckets.Days31to60)
	buckets.Days61to90 = round2(buckets.Days61to90)
	buckets.Days90Plus = round2(buckets.Days90Plus)
	buckets.Total = round2(buckets.Total)

	return map[string]any{
		"kind":    kind,
		"buckets": buckets,
		"items":   items,
	}, nil
}
