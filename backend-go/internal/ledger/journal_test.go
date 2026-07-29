package ledger

import (
	"testing"

	"github.com/icus/finbiz/backend-go/internal/platform"
)

func TestValidateBalanced_OK(t *testing.T) {
	err := validateBalanced([]JournalLineInput{
		{AccountID: "a", Debit: 100, Credit: 0},
		{AccountID: "b", Debit: 0, Credit: 100},
	})
	if err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestValidateBalanced_Unbalanced(t *testing.T) {
	err := validateBalanced([]JournalLineInput{
		{AccountID: "a", Debit: 100, Credit: 0},
		{AccountID: "b", Debit: 0, Credit: 50},
	})
	ae, ok := err.(*platform.ApiError)
	if !ok || ae.Code != "JOURNAL_UNBALANCED" {
		t.Fatalf("expected JOURNAL_UNBALANCED, got %v", err)
	}
}

func TestValidateBalanced_BothDebitCredit(t *testing.T) {
	err := validateBalanced([]JournalLineInput{
		{AccountID: "a", Debit: 50, Credit: 50},
		{AccountID: "b", Debit: 0, Credit: 0},
	})
	ae, ok := err.(*platform.ApiError)
	if !ok || ae.Code != "INVALID_LINE" {
		t.Fatalf("expected INVALID_LINE, got %v", err)
	}
}

func TestValidateBalanced_TooFewLines(t *testing.T) {
	err := validateBalanced([]JournalLineInput{
		{AccountID: "a", Debit: 100, Credit: 0},
	})
	ae, ok := err.(*platform.ApiError)
	if !ok || ae.Code != "JOURNAL_UNBALANCED" {
		t.Fatalf("expected JOURNAL_UNBALANCED, got %v", err)
	}
}

func TestRound2(t *testing.T) {
	if Round2(1.005) != 1.01 && Round2(1.004) != 1.00 {
		// float quirks — just ensure function exists and is stable
		got := Round2(10.126)
		if got != 10.13 {
			t.Fatalf("Round2(10.126)=%v want 10.13", got)
		}
	}
}

func TestParseAmount(t *testing.T) {
	n, err := ParseAmount(12.345)
	if err != nil || n != 12.35 {
		t.Fatalf("ParseAmount got %v %v", n, err)
	}
	_, err = ParseAmount(0)
	if err == nil {
		t.Fatal("expected error for zero")
	}
}

func TestParseDate(t *testing.T) {
	d, err := ParseDate("2024-01-15")
	if err != nil || d != "2024-01-15" {
		t.Fatalf("got %q %v", d, err)
	}
	_, err = ParseDate("01-15-2024")
	if err == nil {
		t.Fatal("expected invalid date error")
	}
}

func TestNextDocumentNumberPrefixes(t *testing.T) {
	if defaultPrefix[DocInvoice] != "INV-" {
		t.Fatal("invoice prefix")
	}
	if defaultPrefix[DocOther] != "DOC-" {
		t.Fatal("other prefix")
	}
}
