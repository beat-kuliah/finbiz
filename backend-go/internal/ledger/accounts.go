package ledger

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AccountRow is an account with computed balance.
type AccountRow struct {
	ID      string  `json:"id"`
	Code    string  `json:"code"`
	Name    string  `json:"name"`
	Type    string  `json:"type"`
	IsCash  bool    `json:"isCash"`
	Balance float64 `json:"balance"`
}

// ListAccountsWithBalances returns accounts for an org with posted balances.
func ListAccountsWithBalances(ctx context.Context, db *pgxpool.Pool, orgID string) ([]AccountRow, error) {
	rows, err := db.Query(ctx, `
		SELECT a.id, a.code, a.name, a.type, a.is_cash,
			coalesce(sum(case when je.status = 'posted' then jl.debit::numeric else 0 end), 0),
			coalesce(sum(case when je.status = 'posted' then jl.credit::numeric else 0 end), 0)
		FROM accounts a
		LEFT JOIN journal_lines jl ON jl.account_id = a.id
		LEFT JOIN journal_entries je ON je.id = jl.entry_id
		WHERE a.org_id = $1
		GROUP BY a.id
		ORDER BY a.code
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AccountRow
	for rows.Next() {
		var (
			r                      AccountRow
			totalDebit, totalCredit float64
		)
		if err := rows.Scan(&r.ID, &r.Code, &r.Name, &r.Type, &r.IsCash, &totalDebit, &totalCredit); err != nil {
			return nil, err
		}
		r.Balance = computeBalance(r.Type, totalDebit, totalCredit)
		out = append(out, r)
	}
	return out, rows.Err()
}
