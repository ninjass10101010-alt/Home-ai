/**
 * AllowanceWidget — what Consuela's points are worth, and the truth about
 * cashing them out.
 *
 * Shows:
 *   - Current points balance (real: the server-owned weekData ledger)
 *   - The cash equivalent, ONLY when a parent has actually configured a rate
 *   - The honest state of cash-out (see below)
 *
 * ⚠️ Cash-out is NOT AVAILABLE, and this widget must never imply that it is.
 * The old kid-mode "Cash Out $X" button made no API call, deducted nothing,
 * wrote a fabricated withdrawal into localStorage and congratulated the child
 * that their money had gone to a hardcoded account fragment. There is no
 * transfer endpoint anywhere in the app: `GREENLIGHT_API_KEY` is registered
 * "stored for when the integration is enabled" and `pointsToCashRate` is read
 * but never written by any settings surface. So the button is disabled with a
 * real explanation rather than wired to a fiction — a child is never told their
 * money moved when it did not.
 *
 * Requires: Greenlight connected via Settings → Connections.
 */
"use client";

import { useState, useEffect } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import { isConnected, getCredentials } from "@/lib/connections/store";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardMode } from "@/hooks/useDashboardMode";
import { currentWeekPoints } from "@/modes/kid/kid-store";

const NO_CASH_OUT =
  "Cashing out isn't set up yet — Consuela can show your points, but it can't move money.";

export default function AllowanceWidget() {
  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState(0);

  const { currentUser } = useAuth();
  const { mode } = useDashboardMode();

  useEffect(() => {
    setEnabled(isConnected("greenlight"));
  }, []);

  useEffect(() => {
    if (!enabled || !currentUser) return;

    // Load points — same weekData ledger KidHome/RewardsShop read (the old
    // per-member "consuela-points-*" key was a dead ledger nothing wrote).
    setPoints(currentWeekPoints(currentUser.name).points);
  }, [enabled, currentUser]);

  // The conversion rate is a parent-configured credential. Nothing in the app
  // writes it, so an unset rate must read as UNSET — not silently default to
  // an invented "50 points = $1" that then prices a child's savings.
  const creds = enabled ? getCredentials("greenlight") : null;
  const parsedRate = Number.parseInt(creds?.pointsToCashRate ?? "", 10);
  const rateConfigured = Number.isFinite(parsedRate) && parsedRate > 0;
  const conversionRate = rateConfigured ? parsedRate : 0;
  const cashValue = rateConfigured ? points / conversionRate : 0;

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
          <span className="text-xs font-bold text-[var(--color-accent-mint)] uppercase tracking-wider">
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
              <p className="text-xs text-text-muted uppercase tracking-wider">Points Balance</p>
              <p className="text-2xl font-black text-text-primary tabular-nums">{points}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-muted uppercase tracking-wider">Cash Value</p>
              <p className="text-2xl font-black text-[var(--color-accent-mint)] tabular-nums">
                {rateConfigured ? `$${cashValue.toFixed(2)}` : "—"}
              </p>
            </div>
          </div>
          <p className="text-xs text-text-muted mt-2">
            {rateConfigured
              ? `${conversionRate} points = $1.00`
              : "No cash rate set yet"}
          </p>
        </div>

        {/* Cash Out — unavailable, and honest about it */}
        {isKid && (
          <div>
            <SoftButton
              onClick={() => {}}
              disabled
              aria-label="Cash Out is not available yet"
              className="w-full text-base py-3"
            >
              💸 Cash Out
            </SoftButton>
            <p className="text-xs text-text-muted text-center mt-2">
              {NO_CASH_OUT} Your points are safe right here — ask a grown-up if you
              want to cash out.
            </p>
            {points <= 0 && (
              <p className="text-xs text-text-muted text-center mt-1">
                Complete quests to earn points!
              </p>
            )}
          </div>
        )}

        {/* Parent View — the cash-out state, stated once and honestly */}
        {!isKid && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Conversion Rate</span>
              <span className="font-bold text-text-primary tabular-nums">
                {rateConfigured ? `${conversionRate} pts = $1` : "Not set"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">Cash-Out</span>
              <span className="font-bold text-text-primary">Not set up</span>
            </div>
            <p className="text-xs text-text-muted">
              {NO_CASH_OUT} Points are real and stay in Consuela; there is no
              Greenlight transfer wired up yet, so nothing can be moved to a card
              from here.
            </p>
          </div>
        )}
      </div>
    </Surface>
  );
}
