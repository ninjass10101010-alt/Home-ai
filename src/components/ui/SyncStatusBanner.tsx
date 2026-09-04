"use client";

import { useAuth } from "@/hooks/useAuth";

/**
 * SyncStatusBanner — a loud, always-visible strip shown when this browser
 * has no family session. A signed-out browser keeps showing its last saved
 * copy with every save staying on this device only; without this banner
 * that state is indistinguishable from "synced", which is exactly how
 * cross-device edits look "lost". Rendered by PageShell so it covers every
 * data screen (Home, Meals, Tasks, Calendar, Settings); the chat page renders
 * it directly with surface-specific copy (chat has no session, yet guest AI
 * still answers — the danger is believing you're in the family thread).
 */
export default function SyncStatusBanner({
  message,
  className,
}: {
  message?: string;
  className?: string;
}) {
  const { isLoggedIn } = useAuth();
  if (isLoggedIn) return null;
  return (
    <div
      data-testid="sync-status-banner"
      role="status"
      className={`${className ?? "mx-4 mt-3"} rounded-2xl border border-[var(--color-accent-amber)]/40 bg-[var(--color-accent-amber)]/15 px-4 py-2.5 text-center text-[13px] font-semibold text-[var(--color-text-primary)]`}
    >
      {message ??
        "🔐 Signed out — showing your saved copy. Sign in with your PIN to sync changes across devices."}
    </div>
  );
}
