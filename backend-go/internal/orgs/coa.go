package orgs

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// BusinessType for COA seeding.
type BusinessType string

const (
	BusinessUMKM    BusinessType = "umkm"
	BusinessRetail  BusinessType = "retail"
	BusinessService BusinessType = "service"
)

type coaTemplate struct {
	Code     string
	Name     string
	Type     string
	IsCash   bool
	IsSystem bool
}

var umkmCOA = []coaTemplate{
	{Code: "1100", Name: "Kas", Type: "asset", IsCash: true, IsSystem: true},
	{Code: "1200", Name: "Bank", Type: "asset", IsCash: true, IsSystem: true},
	{Code: "1300", Name: "Piutang Usaha", Type: "asset", IsSystem: true},
	{Code: "1400", Name: "Persediaan", Type: "asset", IsSystem: true},
	{Code: "1500", Name: "Aset Tetap", Type: "asset", IsSystem: true},
	{Code: "1510", Name: "Akumulasi Penyusutan", Type: "asset", IsSystem: true},
	{Code: "2100", Name: "Hutang Usaha", Type: "liability", IsSystem: true},
	{Code: "2200", Name: "Hutang Bank", Type: "liability", IsSystem: true},
	{Code: "3100", Name: "Modal", Type: "equity", IsSystem: true},
	{Code: "3200", Name: "Prive", Type: "equity", IsSystem: true},
	{Code: "3300", Name: "Laba Ditahan", Type: "equity", IsSystem: true},
	{Code: "4100", Name: "Pendapatan Usaha", Type: "revenue", IsSystem: true},
	{Code: "4200", Name: "Pendapatan Lain-lain", Type: "revenue", IsSystem: true},
	{Code: "5100", Name: "Beban Operasional", Type: "expense", IsSystem: true},
	{Code: "5200", Name: "Beban Penyusutan", Type: "expense", IsSystem: true},
	{Code: "5300", Name: "Beban Lain-lain", Type: "expense", IsSystem: true},
}

var retailExtra = []coaTemplate{
	{Code: "1310", Name: "Piutang Karyawan", Type: "asset", IsSystem: true},
	{Code: "4110", Name: "Pendapatan Penjualan", Type: "revenue", IsSystem: true},
}

var serviceExtra = []coaTemplate{
	{Code: "4120", Name: "Pendapatan Jasa", Type: "revenue", IsSystem: true},
	{Code: "5110", Name: "Beban Gaji", Type: "expense", IsSystem: true},
}

func templatesForBusinessType(bt BusinessType) []coaTemplate {
	base := append([]coaTemplate{}, umkmCOA...)
	switch bt {
	case BusinessRetail:
		base = append(base, retailExtra...)
	case BusinessService:
		base = append(base, serviceExtra...)
	}
	return base
}

// coaQuerier is satisfied by pgx.Tx and *pgxpool.Pool.
type coaQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// SeedChartOfAccounts seeds COA idempotently (skips if any accounts exist).
// Returns map of code -> account id.
func SeedChartOfAccounts(ctx context.Context, q coaQuerier, orgID string, businessType BusinessType) (map[string]string, error) {
	codeToID := map[string]string{}

	rows, err := q.Query(ctx, `SELECT id, code FROM accounts WHERE org_id = $1`, orgID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, code string
		if err := rows.Scan(&id, &code); err != nil {
			rows.Close()
			return nil, err
		}
		codeToID[code] = id
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(codeToID) > 0 {
		return codeToID, nil
	}

	templates := templatesForBusinessType(businessType)
	for _, t := range templates {
		var id string
		err := q.QueryRow(ctx, `
			INSERT INTO accounts (org_id, code, name, type, is_cash, is_system)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id
		`, orgID, t.Code, t.Name, t.Type, t.IsCash, t.IsSystem).Scan(&id)
		if err != nil {
			return nil, err
		}
		codeToID[t.Code] = id
	}
	return codeToID, nil
}

// GetAccountIDByCode looks up a code in the seed map.
func GetAccountIDByCode(codeToID map[string]string, code string) (string, bool) {
	id, ok := codeToID[code]
	return id, ok
}
