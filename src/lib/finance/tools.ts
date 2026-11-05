// src/lib/finance/tools.ts
// Tools for Alex (Family Finance Advisor & Accountant).
// Queries The Ledger / finance-dashboard API at FINANCE_DASHBOARD_URL.

import type { Tool } from "@/lib/hermes-tools";
import {
  summarizeLedger,
  latestMonthKey,
  type LedgerDashboardPayload,
  type LedgerMonth,
} from "./ledger-summary";

function getFinanceDashboardUrl(): string {
  return process.env.FINANCE_DASHBOARD_URL?.trim() || "http://finance-dashboard";
}

async function fetchDashboardData(): Promise<LedgerDashboardPayload> {
  const url = getFinanceDashboardUrl();
  const res = await fetch(`${url}/api/data/dashboard`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) {
    throw new Error(`Finance dashboard returned HTTP ${res.status}`);
  }
  return res.json();
}

function resolveMonth(
  data: LedgerDashboardPayload,
  requestedMonth?: string
): { key: string; month: LedgerMonth } {
  const yearData = data.yearData ?? {};
  let key = requestedMonth?.trim();
  if (!key || !yearData[key]) {
    key = data.selectedMonthKey && yearData[data.selectedMonthKey]
      ? data.selectedMonthKey
      : latestMonthKey(data) ?? "";
  }
  const month = yearData[key] ?? {};
  return { key, month };
}

export const FINANCE_TOOLS: Tool[] = [
  {
    definition: {
      name: "get_finance_summary",
      description:
        "Get the Garcia family monthly financial summary from The Ledger: total cash, total debt, total budgeted, total spent, remaining to spend, and budget surplus/deficit.",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "Optional month key in YYYY-MM format (e.g. '2026-11'). Defaults to the active month.",
          },
        },
      },
    },
    handler: async (args) => {
      try {
        const data = await fetchDashboardData();
        const { key, month } = resolveMonth(data, args.month);
        if (!key) {
          return JSON.stringify({ error: "No financial ledger data available." });
        }

        const summary = summarizeLedger(data);
        const ledger = month.ledger ?? {};
        const accounts = (month.accounts ?? []).map((a) => ({
          name: a.name,
          institution: a.institution,
          type: a.type,
          balance: a.balance,
          delta: a.delta,
        }));

        const totalCash = accounts
          .filter((a) => a.type === "Checking" || a.type === "Savings")
          .reduce((sum, a) => sum + (a.balance || 0), 0);

        const totalDebt = accounts
          .filter((a) => a.type === "Loan")
          .reduce((sum, a) => sum + (a.balance || 0), 0);

        const totalBudgeted = ledger.totalBudgeted ?? 0;
        const totalSpent = ledger.totalSpent ?? 0;
        const remaining = totalBudgeted - totalSpent;

        return JSON.stringify({
          monthKey: key,
          monthLabel: month.period?.monthLabel
            ? `${month.period.monthLabel} ${month.period.yearLabel ?? ""}`.trim()
            : key,
          cash: Number(totalCash.toFixed(2)),
          debt: Number(totalDebt.toFixed(2)),
          netWorth: Number((totalCash - totalDebt).toFixed(2)),
          totalBudgeted: Number(totalBudgeted.toFixed(2)),
          totalSpent: Number(totalSpent.toFixed(2)),
          remainingToSpend: Number(remaining.toFixed(2)),
          projectedSurplus: (ledger as any).projectedSurplus ?? 0,
          status: remaining >= 0 ? "on_track" : "over_budget",
          accounts,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to load finance summary from The Ledger",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "get_bank_balances",
      description:
        "Get current balances for all family bank and debt accounts (LMCU Checking, Huntington Checking, LMCU Shares, Tesla Loan, Mortgage). Account numbers are strictly masked for privacy (last-4 digits only).",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    handler: async () => {
      try {
        const data = await fetchDashboardData();
        const { key, month } = resolveMonth(data);
        const accounts = (month.accounts ?? []).map((a) => ({
          name: a.name,
          institution: a.institution,
          type: a.type,
          balance: a.balance,
          delta: a.delta,
        }));

        const cashAccounts = accounts.filter((a) => a.type === "Checking" || a.type === "Savings");
        const loanAccounts = accounts.filter((a) => a.type === "Loan");

        const totalCash = cashAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
        const totalDebt = loanAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);

        return JSON.stringify({
          monthKey: key,
          totalCash: Number(totalCash.toFixed(2)),
          totalDebt: Number(totalDebt.toFixed(2)),
          cashAccounts,
          loanAccounts,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to load bank balances from The Ledger",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "get_bills_status",
      description:
        "Get the status of all recurring monthly bills (Mortgage, Tesla, Insurance, Utilities, Daycare, HOA) for the current or specified month, including due dates, budgeted amounts, actual paid amounts, and status (Scheduled / Paid / Due).",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "Optional month key in YYYY-MM format (e.g. '2026-11'). Defaults to active month.",
          },
        },
      },
    },
    handler: async (args) => {
      try {
        const data = await fetchDashboardData();
        const { key, month } = resolveMonth(data, args.month);
        const bills = ((month as any).bills ?? []).map((b: any) => ({
          name: b.name,
          vendor: b.vendor ?? "Shared",
          amount: b.amount ?? 0,
          actual: b.actual ?? 0,
          dueDay: b.dueDay,
          status: b.status ?? "Scheduled",
          note: b.note ?? "",
        }));

        const totalDue = bills.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
        const totalPaid = bills.reduce((sum: number, b: any) => sum + (b.actual || 0), 0);

        return JSON.stringify({
          monthKey: key,
          billCount: bills.length,
          totalDue: Number(totalDue.toFixed(2)),
          totalPaid: Number(totalPaid.toFixed(2)),
          bills,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to load bills status from The Ledger",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "get_spending_by_category",
      description:
        "Get itemized monthly spending and expenses by category (Groceries, Restaurants, Gas, Utilities, Lifestyle), comparing budgeted vs actual spending and flagging any over-budget categories.",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "Optional month key in YYYY-MM format (e.g. '2026-11'). Defaults to active month.",
          },
          category: {
            type: "string",
            description: "Optional specific expense name or group to filter by (e.g. 'Groceries').",
          },
        },
      },
    },
    handler: async (args) => {
      try {
        const data = await fetchDashboardData();
        const { key, month } = resolveMonth(data, args.month);
        let expenses = ((month as any).expenses ?? []).map((e: any) => ({
          name: e.name,
          group: e.group ?? "Living",
          budgeted: e.budgeted ?? 0,
          actual: e.actual ?? 0,
          overBudget: Boolean(e.overBudget || (e.actual > e.budgeted && e.budgeted > 0)),
          variance: Number(((e.budgeted ?? 0) - (e.actual ?? 0)).toFixed(2)),
        }));

        if (args.category) {
          const filter = String(args.category).toLowerCase().trim();
          expenses = expenses.filter(
            (e: any) =>
              e.name.toLowerCase().includes(filter) ||
              e.group.toLowerCase().includes(filter)
          );
        }

        const totalBudgeted = expenses.reduce((sum: number, e: any) => sum + (e.budgeted || 0), 0);
        const totalSpent = expenses.reduce((sum: number, e: any) => sum + (e.actual || 0), 0);
        const overBudgetCategories = expenses
          .filter((e: any) => e.overBudget)
          .map((e: any) => e.name);

        return JSON.stringify({
          monthKey: key,
          categoryCount: expenses.length,
          totalBudgeted: Number(totalBudgeted.toFixed(2)),
          totalSpent: Number(totalSpent.toFixed(2)),
          overBudgetCategories,
          expenses,
        });
      } catch (err: any) {
        return JSON.stringify({
          error: "Failed to load spending categories from The Ledger",
          details: err?.message || String(err),
        });
      }
    },
  },
  {
    definition: {
      name: "trigger_finance_rebuild",
      description:
        "Trigger a data refresh and rebuild of the finance dashboard from the latest Google Sheets and bank statements.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    handler: async () => {
      try {
        const url = getFinanceDashboardUrl();
        const res = await fetch(`${url}/api/rebuild`, {
          method: "POST",
          signal: AbortSignal.timeout(30000),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return JSON.stringify({
            ok: false,
            error: body.detail || `Rebuild returned HTTP ${res.status}`,
          });
        }
        return JSON.stringify({
          ok: true,
          status: body.status || "success",
          message: body.message || "Dashboard rebuilt and deployed",
        });
      } catch (err: any) {
        return JSON.stringify({
          ok: false,
          error: "Failed to trigger finance dashboard rebuild",
          details: err?.message || String(err),
        });
      }
    },
  },
];
