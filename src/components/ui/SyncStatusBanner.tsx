"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

/**
 * SyncStatusBanner — a loud, always-visible strip shown when this browser
 * has no family session. A signed-out browser keeps showing its last saved
 * copy with every save staying on this device only; without this banner
 * that state is indistinguishable from "synced", which is exactly how
 * cross-device edits look "lost". Rendered by PageShell so it covers every
 * data screen (Home, Meals, Tasks, Calendar, Settings, chat); pages can pass
 * surface-specific copy through the shell (chat has no session, yet guest AI
 * still answers — the danger is believing you're in the family thread).
 *
 * Audit P0-4: the banner told the user to "sign in with your PIN" without any
 * way to do it from where they stood. Sign-in lives in Settings → Me, so the
 * banner now links there instead of leaving the instruction inert.
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
      className={`${className ?? "mx-4 mt-3"} flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border border-[var(--color-accent-amber)]/40 bg-[var(--color-accent-amber)]/15 px-4 py-2.5 text-center text-[13px] font-semibold text-[var(--color-text-primary)]`}
    >
      <span>
        {message ?? "🔐 Signed out — showing your saved copy. Every change stays on this device until you sign in."}
      </span>
      <Link
        href="/settings"
        data-testid="sync-status-banner-signin"
        className="underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-amber)]"
      >
        Sign in with your PIN →
      </Link>
    </div>
  );
}
