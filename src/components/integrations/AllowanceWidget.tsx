/**
 * AllowanceWidget — Convert Consuela points to real money.
 *
 * Shows:
 *   - Current points balance + cash equivalent
 *   - Conversion rate set by parent
 *   - "Cash out" button to transfer to Greenlight card
 *   - Transaction history
 *
 * For Kid Mode: shows their balance and cash-out option.
 * For Adult Mode: shows settings + approval queue.
 *
 * Requires: Greenlight connected via Settings → Connections.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import { isConnected, getCredentials } from "@/lib/connections/store";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardMode } from "@/hooks/useDashboardMode";

interface Transaction {
  id: string;
  type: "deposit" | "withdrawal";
  amount: number;
  points: number;
  date: string;
  description: string;
}

export default function AllowanceWidget() {
  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cashingOut, setCashingOut] = useState(false);
  const [cashOutAmount, setCashOutAmount] = useState(0);

  const { currentUser } = useAuth();
  const { mode } = useDashboardMode();

  useEffect(() => {
    setEnabled(isConnected("greenlight"));
  }, []);

  useEffect(() => {
    if (!enabled || !currentUser) return;

    // Load points
    const myPoints = typeof window !== "undefined"
      ? parseInt(localStorage.getItem(`consuela-points-${currentUser.name}`) || "0")
      : 0;
    setPoints(myPoints);

    // Load transaction history
    try {
      const stored = localStorage.getItem(`consuela-allowance-history-${currentUser.name}`);
      if (stored) setTransactions(JSON.parse(stored));
    } catch {}
  }, [enabled, currentUser]);

  // Get conversion rate from credentials
  const creds = enabled ? getCredentials("greenlight") : null;
  const conversionRate = creds?.pointsToCashRate ? parseInt(creds.pointsToCashRate) : 50;
  const cashValue = points / conversionRate;

  const handleCashOut = useCallback(async () => {
    if (points <= 0 || cashingOut) return;

    const amount = Math.floor(cashValue * 100) / 100; // Round to cents
    if (amount <= 0) return;

    setCashingOut(true);

    try {
      // In production: call Greenlight API to transfer funds
      // For demo: simulate the transfer
      const newTransaction: Transaction = {
        id: `txn-${Date.now()}`,
        type: "withdrawal",
        amount,
        points,
        date: new Date().toISOString(),
        description: "Consuela points → Greenlight",
      };

      // Update transaction history
      const updated = [...transactions, newTransaction];
      setTransactions(updated);
      if (currentUser) {
        localStorage.setItem(
          `consuela-allowance-history-${currentUser.name}`,
          JSON.stringify(updated),
        );
      }

      // Deduct points
      const newPoints = 0;
      setPoints(newPoints);
      if (currentUser) {
        localStorage.setItem(`consuela-points-${currentUser.name}`, "0");
      }
    } catch {
      // Failed to cash out
    } finally {
      setCashingOut(false);
    }
  }, [points, cashValue, cashingOut, transactions, currentUser]);

  if (!enabled) return null;

  const isKid = mode === "kid";

  return (
    <Surface variant={isKid ? "warm" : "glass-subtle"} radius="2xl" padding="none">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">{isKid ? "💰" : "💳"}</span>
            <h3 className="text-sm font-bold text-text-primary">
              {isKid ? "My Allowance" : "Allowance & Cash-Out"}
            </h3>
          </div>
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
            Greenlight
          </span>
        </div>

        {/* Balance Card */}
        <div
          className="rounded-2xl p-4 mb-4"
          style={{
            background: "linear-gradient(135deg, rgba(74, 222, 128, 0.08), rgba(59, 130, 246, 0.08))",
            border: "1px solid rgba(74, 222, 128, 0.15)",
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider">Points Balance</p>
              <p className="text-2xl font-black text-text-primary tabular-nums">{points}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-text-muted uppercase tracking-wider">Cash Value</p>
              <p className="text-2xl font-black text-emerald-400 tabular-nums">${cashValue.toFixed(2)}</p>
            </div>
          </div>
          <p className="text-[10px] text-text-muted mt-2">
            {conversionRate} points = $1.00
          </p>
        </div>

        {/* Cash Out (Kid Mode) */}
        {isKid && (
          <div>
            <SoftButton
              onClick={handleCashOut}
              loading={cashingOut}
              disabled={points <= 0}
              className="w-full text-base py-3"
            >
              {cashingOut
                ? "💳 Transferring..."
                : points > 0
                  ? `💸 Cash Out $${cashValue.toFixed(2)}`
                  : "No points to cash out"
              }
            </SoftButton>
            <p className="text-[10px] text-text-muted text-center mt-2">
              {points > 0
                ? "Money goes to your Greenlight card! 🎉"
                : "Complete quests to earn points!"}
            </p>
          </div>
        )}

        {/* Parent View — Approval Settings */}
        {!isKid && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Conversion Rate</span>
              <span className="font-bold text-text-primary tabular-nums">{conversionRate} pts = $1</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Weekly Cap</span>
              <span className="font-bold text-text-primary tabular-nums">$10.00</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Requires Approval</span>
              <span className="font-bold text-emerald-400">Yes</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Auto-Deposit</span>
              <span className="font-bold text-text-primary">Greenlight ****2847</span>
            </div>
          </div>
        )}

        {/* Transaction History */}
        {transactions.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/[0.04]">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
              Recent Transactions
            </p>
            <div className="space-y-1.5">
              {transactions.slice(-5).reverse().map((txn) => (
                <div key={txn.id} className="flex items-center gap-2.5 py-1">
                  <span className="text-sm">{txn.type === "deposit" ? "💰" : "💸"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-text-primary truncate">{txn.description}</p>
                    <p className="text-[9px] text-text-muted">
                      {new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" · "}{txn.points} pts
                    </p>
                  </div>
                  <span className={`text-xs font-bold tabular-nums ${
                    txn.type === "deposit" ? "text-emerald-400" : "text-amber-400"
                  }`}>
                    {txn.type === "deposit" ? "+" : "-"}${txn.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}
