package assets

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/icus/finbiz/backend-go/internal/ledger"
	"github.com/icus/finbiz/backend-go/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var periodYmRe = regexp.MustCompile(`^\d{4}-\d{2}$`)

// CreateAssetInput is input for createAsset.
type CreateAssetInput struct {
	OrgID            string
	UserID           string
	Name             string
	AcquisitionDate  string
	AcquisitionCost  float64
	SalvageValue     *float64
	UsefulLifeMonths int
	AccountID        string
	PayWithCash      *bool
	CashAccountID    string
	Memo             string
}

// AssetResult is the fixed asset API shape.
type AssetResult struct {
	ID                                string  `json:"id"`
	Name                              string  `json:"name"`
	AcquisitionDate                   string  `json:"acquisitionDate"`
	AcquisitionCost                   float64 `json:"acquisitionCost"`
	SalvageValue                      float64 `json:"salvageValue"`
	UsefulLifeMonths                  int     `json:"usefulLifeMonths"`
	AccountID                         string  `json:"accountId"`
	DepreciationAccountID             *string `json:"depreciationAccountId"`
	AccumulatedDepreciationAccountID  *string `json:"accumulatedDepreciationAccountId"`
	DocumentID                        *string `json:"documentId,omitempty"`
}

// DepreciationRunResult is one processed depreciation run.
type DepreciationRunResult struct {
	AssetID   string  `json:"assetId"`
	AssetName string  `json:"assetName"`
	Amount    float64 `json:"amount"`
	EntryID   string  `json:"entryId"`
}

// DepreciationResult is the runDepreciation response.
type DepreciationResult struct {
	PeriodYm  string                  `json:"periodYm"`
	Processed int                     `json:"processed"`
	Skipped   int                     `json:"skipped"`
	Runs      []DepreciationRunResult `json:"runs"`
}

// DisposeInput is input for disposeAsset.
type DisposeInput struct {
	Proceeds float64
	Date     string
	Memo     string
}

// DisposeResult is the disposeAsset response.
type DisposeResult struct {
	AssetID    string `json:"assetId"`
	EntryID    string `json:"entryId"`
	DocumentID string `json:"documentId"`
}

func formatAmt(n float64) string {
	return fmt.Sprintf("%.2f", ledger.Round2(n))
}

func monthlyDepreciation(cost, salvage float64, usefulLifeMonths int) (float64, error) {
	if usefulLifeMonths <= 0 {
		return 0, platform.NewApiError(http.StatusBadRequest, "INVALID_ASSET",
			"usefulLifeMonths must be positive")
	}
	return ledger.Round2((cost - salvage) / float64(usefulLifeMonths)), nil
}

func periodDateFromYm(periodYm string) (string, error) {
	if !periodYmRe.MatchString(periodYm) {
		return "", platform.NewApiError(http.StatusBadRequest, "INVALID_DATE", "periodYm must be YYYY-MM")
	}
	return periodYm + "-01", nil
}

// ListAssets lists fixed assets for an org.
func ListAssets(ctx context.Context, db *pgxpool.Pool, orgID string) ([]AssetResult, error) {
	rows, err := db.Query(ctx, `
		SELECT id, name, acquisition_date::text, acquisition_cost::text, salvage_value::text,
			useful_life_months, account_id, depreciation_account_id, accumulated_depreciation_account_id
		FROM fixed_assets
		WHERE org_id = $1
		ORDER BY acquisition_date
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assets := []AssetResult{}
	for rows.Next() {
		var (
			a              AssetResult
			costS, salvS   string
		)
		if err := rows.Scan(
			&a.ID, &a.Name, &a.AcquisitionDate, &costS, &salvS,
			&a.UsefulLifeMonths, &a.AccountID, &a.DepreciationAccountID, &a.AccumulatedDepreciationAccountID,
		); err != nil {
			return nil, err
		}
		a.AcquisitionCost, _ = strconv.ParseFloat(costS, 64)
		a.SalvageValue, _ = strconv.ParseFloat(salvS, 64)
		assets = append(assets, a)
	}
	return assets, rows.Err()
}

// CreateAsset purchases a fixed asset and posts the acquisition journal.
func CreateAsset(ctx context.Context, db *pgxpool.Pool, input CreateAssetInput) (*AssetResult, error) {
	acquisitionCost, err := ledger.ParseAmount(input.AcquisitionCost)
	if err != nil {
		return nil, err
	}

	salvageValue := 0.0
	if input.SalvageValue != nil {
		salvageValue = math.Max(0, ledger.Round2(*input.SalvageValue))
	}
	if salvageValue >= acquisitionCost {
		return nil, platform.NewApiError(http.StatusBadRequest, "INVALID_ASSET",
			"Salvage value must be less than acquisition cost")
	}

	acquisitionDate, err := ledger.ParseDate(input.AcquisitionDate)
	if err != nil {
		return nil, err
	}
	entryDate, err := time.Parse("2006-01-02", acquisitionDate)
	if err != nil {
		return nil, platform.NewApiError(http.StatusBadRequest, "INVALID_DATE", "Date must be YYYY-MM-DD")
	}

	memo := strings.TrimSpace(input.Memo)
	if memo == "" {
		memo = "Pembelian aset: " + input.Name
	}

	assetAccountID := input.AccountID
	if assetAccountID == "" {
		assetAccountID, err = ledger.GetSystemAccountByCode(ctx, db, input.OrgID, ledger.COA_CODES.ASET_TETAP)
		if err != nil {
			return nil, err
		}
	}
	depExpenseID, err := ledger.GetSystemAccountByCode(ctx, db, input.OrgID, ledger.COA_CODES.BEBAN_PENYUSUTAN)
	if err != nil {
		return nil, err
	}
	accDepID, err := ledger.GetSystemAccountByCode(ctx, db, input.OrgID, ledger.COA_CODES.AKUM_PENYUSUTAN)
	if err != nil {
		return nil, err
	}

	payWithCash := true
	if input.PayWithCash != nil {
		payWithCash = *input.PayWithCash
	}

	var creditAccountID string
	if payWithCash {
		creditAccountID = input.CashAccountID
		if creditAccountID == "" {
			creditAccountID, err = ledger.GetDefaultCashAccount(ctx, db, input.OrgID)
			if err != nil {
				return nil, err
			}
		}
	} else {
		creditAccountID, err = ledger.GetSystemAccountByCode(ctx, db, input.OrgID, ledger.COA_CODES.HUTANG_USAHA)
		if err != nil {
			return nil, err
		}
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	number, err := ledger.NextDocumentNumber(ctx, tx, input.OrgID, ledger.DocOther)
	if err != nil {
		return nil, err
	}

	meta, _ := json.Marshal(map[string]any{
		"kind": "asset_purchase", "assetName": input.Name,
	})

	var docID string
	err = tx.QueryRow(ctx, `
		INSERT INTO documents (org_id, type, number, date, status, description, total_amount, metadata)
		VALUES ($1, 'other', $2, $3, 'posted', $4, $5, $6)
		RETURNING id
	`, input.OrgID, number, acquisitionDate, memo, formatAmt(acquisitionCost), meta).Scan(&docID)
	if err != nil {
		return nil, err
	}

	userID := input.UserID
	_, err = ledger.PostJournal(ctx, db, ledger.PostJournalInput{
		OrgID:       input.OrgID,
		Date:        entryDate,
		Description: memo,
		Lines: []ledger.JournalLineInput{
			{AccountID: assetAccountID, Debit: acquisitionCost},
			{AccountID: creditAccountID, Credit: acquisitionCost},
		},
		DocumentID: &docID,
		UserID:     &userID,
		Tx:         tx,
	})
	if err != nil {
		return nil, err
	}

	var (
		asset AssetResult
		costS, salvS string
	)
	err = tx.QueryRow(ctx, `
		INSERT INTO fixed_assets (
			org_id, account_id, depreciation_account_id, accumulated_depreciation_account_id,
			name, acquisition_date, acquisition_cost, salvage_value, useful_life_months
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, name, acquisition_date::text, acquisition_cost::text, salvage_value::text,
			useful_life_months, account_id, depreciation_account_id, accumulated_depreciation_account_id
	`, input.OrgID, assetAccountID, depExpenseID, accDepID,
		input.Name, acquisitionDate, formatAmt(acquisitionCost), formatAmt(salvageValue), input.UsefulLifeMonths,
	).Scan(
		&asset.ID, &asset.Name, &asset.AcquisitionDate, &costS, &salvS,
		&asset.UsefulLifeMonths, &asset.AccountID, &asset.DepreciationAccountID, &asset.AccumulatedDepreciationAccountID,
	)
	if err != nil {
		return nil, err
	}
	asset.AcquisitionCost, _ = strconv.ParseFloat(costS, 64)
	asset.SalvageValue, _ = strconv.ParseFloat(salvS, 64)
	asset.DocumentID = &docID

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &asset, nil
}

// RunDepreciation posts monthly depreciation for all assets in a period.
func RunDepreciation(ctx context.Context, db *pgxpool.Pool, orgID, userID, periodYm string) (*DepreciationResult, error) {
	periodDate, err := periodDateFromYm(periodYm)
	if err != nil {
		return nil, err
	}
	entryDate, err := time.Parse("2006-01-02", periodDate)
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(ctx, `
		SELECT id, name, acquisition_cost::text, salvage_value::text, useful_life_months,
			depreciation_account_id, accumulated_depreciation_account_id
		FROM fixed_assets WHERE org_id = $1
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type assetRow struct {
		ID           string
		Name         string
		Cost         float64
		Salvage      float64
		LifeMonths   int
		DepExpenseID *string
		AccDepID     *string
	}
	assets := []assetRow{}
	for rows.Next() {
		var (
			a          assetRow
			costS, salvS string
		)
		if err := rows.Scan(&a.ID, &a.Name, &costS, &salvS, &a.LifeMonths, &a.DepExpenseID, &a.AccDepID); err != nil {
			return nil, err
		}
		a.Cost, _ = strconv.ParseFloat(costS, 64)
		a.Salvage, _ = strconv.ParseFloat(salvS, 64)
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := &DepreciationResult{
		PeriodYm: periodYm,
		Runs:     []DepreciationRunResult{},
	}

	for _, asset := range assets {
		var existing string
		err := db.QueryRow(ctx, `
			SELECT id FROM depreciation_runs
			WHERE fixed_asset_id = $1 AND period_date = $2
			LIMIT 1
		`, asset.ID, periodDate).Scan(&existing)
		if err == nil {
			result.Skipped++
			continue
		}
		if err != pgx.ErrNoRows {
			return nil, err
		}

		amount, err := monthlyDepreciation(asset.Cost, asset.Salvage, asset.LifeMonths)
		if err != nil {
			return nil, err
		}
		if amount <= 0 {
			result.Skipped++
			continue
		}

		depExpenseID := ""
		if asset.DepExpenseID != nil {
			depExpenseID = *asset.DepExpenseID
		}
		if depExpenseID == "" {
			depExpenseID, err = ledger.GetSystemAccountByCode(ctx, db, orgID, ledger.COA_CODES.BEBAN_PENYUSUTAN)
			if err != nil {
				return nil, err
			}
		}
		accDepID := ""
		if asset.AccDepID != nil {
			accDepID = *asset.AccDepID
		}
		if accDepID == "" {
			accDepID, err = ledger.GetSystemAccountByCode(ctx, db, orgID, ledger.COA_CODES.AKUM_PENYUSUTAN)
			if err != nil {
				return nil, err
			}
		}

		memo := fmt.Sprintf("Penyusutan %s — %s", asset.Name, periodYm)
		uid := userID
		entryID, err := ledger.PostJournal(ctx, db, ledger.PostJournalInput{
			OrgID:       orgID,
			Date:        entryDate,
			Description: memo,
			Lines: []ledger.JournalLineInput{
				{AccountID: depExpenseID, Debit: amount},
				{AccountID: accDepID, Credit: amount},
			},
			UserID: &uid,
		})
		if err != nil {
			return nil, err
		}

		_, err = db.Exec(ctx, `
			INSERT INTO depreciation_runs (org_id, fixed_asset_id, journal_entry_id, period_date, amount)
			VALUES ($1, $2, $3, $4, $5)
		`, orgID, asset.ID, entryID, periodDate, formatAmt(amount))
		if err != nil {
			return nil, err
		}

		result.Runs = append(result.Runs, DepreciationRunResult{
			AssetID:   asset.ID,
			AssetName: asset.Name,
			Amount:    amount,
			EntryID:   entryID,
		})
	}

	result.Processed = len(result.Runs)
	return result, nil
}

// DisposeAsset posts disposal journal and deletes the asset row.
func DisposeAsset(ctx context.Context, db *pgxpool.Pool, orgID, userID, assetID string, input DisposeInput) (*DisposeResult, error) {
	var (
		name, accountID string
		accDepAccountID *string
		costS           string
	)
	err := db.QueryRow(ctx, `
		SELECT name, account_id, accumulated_depreciation_account_id, acquisition_cost::text
		FROM fixed_assets WHERE id = $1 AND org_id = $2
	`, assetID, orgID).Scan(&name, &accountID, &accDepAccountID, &costS)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, platform.NewApiError(http.StatusNotFound, "ASSET_NOT_FOUND", "Fixed asset not found")
		}
		return nil, err
	}
	cost, _ := strconv.ParseFloat(costS, 64)

	proceeds := ledger.Round2(math.Max(0, input.Proceeds))
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
		memo = "Disposal aset: " + name
	}

	var accTotalS string
	err = db.QueryRow(ctx, `
		SELECT coalesce(sum(amount::numeric), 0)::text FROM depreciation_runs WHERE fixed_asset_id = $1
	`, assetID).Scan(&accTotalS)
	if err != nil {
		return nil, err
	}
	accumulated, _ := strconv.ParseFloat(accTotalS, 64)
	bookValue := ledger.Round2(cost - accumulated)
	gainLoss := ledger.Round2(proceeds - bookValue)

	kasID, err := ledger.GetDefaultCashAccount(ctx, db, orgID)
	if err != nil {
		return nil, err
	}
	accDepID := ""
	if accDepAccountID != nil {
		accDepID = *accDepAccountID
	}
	if accDepID == "" {
		accDepID, err = ledger.GetSystemAccountByCode(ctx, db, orgID, ledger.COA_CODES.AKUM_PENYUSUTAN)
		if err != nil {
			return nil, err
		}
	}

	lines := []ledger.JournalLineInput{}
	if proceeds > 0 {
		lines = append(lines, ledger.JournalLineInput{AccountID: kasID, Debit: proceeds})
	}
	if accumulated > 0 {
		lines = append(lines, ledger.JournalLineInput{AccountID: accDepID, Debit: accumulated})
	}
	lines = append(lines, ledger.JournalLineInput{AccountID: accountID, Credit: cost})

	if gainLoss > 0 {
		gainID, err := ledger.GetSystemAccountByCode(ctx, db, orgID, ledger.COA_CODES.PENDAPATAN_LAIN)
		if err != nil {
			return nil, err
		}
		lines = append(lines, ledger.JournalLineInput{AccountID: gainID, Credit: gainLoss})
	} else if gainLoss < 0 {
		lossID, err := ledger.GetSystemAccountByCode(ctx, db, orgID, ledger.COA_CODES.BEBAN_LAIN)
		if err != nil {
			return nil, err
		}
		lines = append(lines, ledger.JournalLineInput{AccountID: lossID, Debit: math.Abs(gainLoss)})
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	number, err := ledger.NextDocumentNumber(ctx, tx, orgID, ledger.DocOther)
	if err != nil {
		return nil, err
	}

	meta, _ := json.Marshal(map[string]any{"kind": "asset_disposal", "assetId": assetID})
	var docID string
	err = tx.QueryRow(ctx, `
		INSERT INTO documents (org_id, type, number, date, status, description, total_amount, metadata)
		VALUES ($1, 'other', $2, $3, 'posted', $4, $5, $6)
		RETURNING id
	`, orgID, number, dateStr, memo, formatAmt(proceeds), meta).Scan(&docID)
	if err != nil {
		return nil, err
	}

	uid := userID
	entryID, err := ledger.PostJournal(ctx, db, ledger.PostJournalInput{
		OrgID:       orgID,
		Date:        entryDate,
		Description: memo,
		Lines:       lines,
		DocumentID:  &docID,
		UserID:      &uid,
		Tx:          tx,
	})
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec(ctx, `DELETE FROM fixed_assets WHERE id = $1`, assetID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &DisposeResult{AssetID: assetID, EntryID: entryID, DocumentID: docID}, nil
}
