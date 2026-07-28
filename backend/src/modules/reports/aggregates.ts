import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  accounts,
  journalEntries,
  journalLines,
  openItems,
} from "../../db/schema.js";

function toNum(value: string | null | undefined): number {
  return Number(value ?? 0);
}

export interface DashboardMetrics {
  cash: number;
  periodRevenue: number;
  periodNetIncome: number;
  receivables: number;
  payables: number;
  equity: number;
}

export interface DateRange {
  from?: string;
  to?: string;
}

function defaultPeriod(): { from: string; to: string } {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

async function accountBalances(orgId: string, asOf?: string) {
  const conditions = [
    eq(journalEntries.orgId, orgId),
    eq(journalEntries.status, "posted"),
  ];
  if (asOf) {
    conditions.push(lte(journalEntries.entryDate, asOf));
  }

  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      isCash: accounts.isCash,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(...conditions))
    .groupBy(
      accounts.id,
      accounts.code,
      accounts.name,
      accounts.type,
      accounts.isCash,
    );

  return rows.map((row) => {
    const debit = toNum(row.debit);
    const credit = toNum(row.credit);
    const balance =
      row.type === "asset" || row.type === "expense"
        ? debit - credit
        : credit - debit;
    return { ...row, debit, credit, balance };
  });
}

async function periodActivity(orgId: string, from: string, to: string) {
  const rows = await db
    .select({
      type: accounts.type,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        eq(journalEntries.status, "posted"),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
      ),
    )
    .groupBy(accounts.type);

  let periodRevenue = 0;
  let periodExpense = 0;

  for (const row of rows) {
    const debit = toNum(row.debit);
    const credit = toNum(row.credit);
    if (row.type === "revenue") periodRevenue += credit - debit;
    if (row.type === "expense") periodExpense += debit - credit;
  }

  return { periodRevenue, periodExpense, periodNetIncome: periodRevenue - periodExpense };
}

export async function getDashboardMetrics(
  orgId: string,
  range?: DateRange,
): Promise<DashboardMetrics> {
  const { from, to } = range?.from && range?.to ? range as { from: string; to: string } : defaultPeriod();
  const balances = await accountBalances(orgId, to);
  const activity = await periodActivity(orgId, from, to);

  const cash = balances
    .filter((a) => a.isCash)
    .reduce((sum, a) => sum + a.balance, 0);

  const receivableItems = await db
    .select({ balance: openItems.balanceAmount })
    .from(openItems)
    .where(and(eq(openItems.orgId, orgId), eq(openItems.type, "receivable")));

  const payableItems = await db
    .select({ balance: openItems.balanceAmount })
    .from(openItems)
    .where(and(eq(openItems.orgId, orgId), eq(openItems.type, "payable")));

  let receivables = receivableItems.reduce((s, i) => s + toNum(i.balance), 0);
  let payables = payableItems.reduce((s, i) => s + toNum(i.balance), 0);

  if (receivables === 0) {
    receivables = balances
      .filter((a) => a.type === "asset" && a.code.startsWith("13"))
      .reduce((s, a) => s + a.balance, 0);
  }
  if (payables === 0) {
    payables = balances
      .filter((a) => a.type === "liability" && a.code.startsWith("21"))
      .reduce((s, a) => s + a.balance, 0);
  }

  const equityAccounts = balances
    .filter((a) => a.type === "equity")
    .reduce((s, a) => s + a.balance, 0);

  const allTimeRevenue = balances
    .filter((a) => a.type === "revenue")
    .reduce((s, a) => s + a.balance, 0);
  const allTimeExpense = balances
    .filter((a) => a.type === "expense")
    .reduce((s, a) => s + a.balance, 0);

  const equity = equityAccounts + (allTimeRevenue - allTimeExpense);

  return {
    cash,
    periodRevenue: activity.periodRevenue,
    periodNetIncome: activity.periodNetIncome,
    receivables,
    payables,
    equity,
  };
}

export async function getProfitLoss(orgId: string, from: string, to: string, breakdown = false) {
  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        eq(journalEntries.status, "posted"),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
        sql`${accounts.type} in ('revenue', 'expense')`,
      ),
    )
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type);

  let totalRevenue = 0;
  let totalExpense = 0;
  const items: Array<{ accountId: string; code: string; name: string; type: string; amount: number }> = [];

  for (const row of rows) {
    const debit = toNum(row.debit);
    const credit = toNum(row.credit);
    const amount =
      row.type === "revenue" ? credit - debit : debit - credit;
    if (row.type === "revenue") totalRevenue += amount;
    else totalExpense += amount;
    if (breakdown) {
      items.push({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        type: row.type,
        amount,
      });
    }
  }

  return {
    totalRevenue,
    totalExpense,
    netIncome: totalRevenue - totalExpense,
    ...(breakdown ? { breakdown: items } : {}),
  };
}

export async function getBalanceSheet(orgId: string, asOf?: string) {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const balances = await accountBalances(orgId, date);

  const totalAssets = balances
    .filter((a) => a.type === "asset")
    .reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = balances
    .filter((a) => a.type === "liability")
    .reduce((s, a) => s + a.balance, 0);
  const equityAccounts = balances
    .filter((a) => a.type === "equity")
    .reduce((s, a) => s + a.balance, 0);
  const netIncome =
    balances.filter((a) => a.type === "revenue").reduce((s, a) => s + a.balance, 0) -
    balances.filter((a) => a.type === "expense").reduce((s, a) => s + a.balance, 0);

  return {
    asOf: date,
    totalAssets,
    totalLiabilities,
    equityWithIncome: equityAccounts + netIncome,
  };
}

export async function getTrialBalance(orgId: string, asOf?: string) {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        eq(journalEntries.status, "posted"),
        lte(journalEntries.entryDate, date),
      ),
    )
    .groupBy(accounts.id, accounts.code, accounts.name);

  let totalDebit = 0;
  let totalCredit = 0;
  const accountsList = rows.map((row) => {
    const debit = toNum(row.debit);
    const credit = toNum(row.credit);
    totalDebit += debit;
    totalCredit += credit;
    return { accountId: row.accountId, code: row.code, name: row.name, debit, credit };
  });

  return { asOf: date, totalDebit, totalCredit, accounts: accountsList };
}

export async function getCashFlow(orgId: string, from: string, to: string) {
  const cashAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.isCash, true)));

  const cashIds = cashAccounts.map((a) => a.id);
  if (cashIds.length === 0) {
    return { from, to, cashIn: 0, cashOut: 0, netCashFlow: 0 };
  }

  const rows = await db
    .select({
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        eq(journalEntries.status, "posted"),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to),
        inArray(journalLines.accountId, cashIds),
      ),
    );

  const cashIn = toNum(rows[0]?.debit);
  const cashOut = toNum(rows[0]?.credit);
  return { from, to, cashIn, cashOut, netCashFlow: cashIn - cashOut };
}
