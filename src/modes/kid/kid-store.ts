/**
 * Shared kid-mode data helpers — one truth with the Tasks page.
 *
 * Points/streaks live in the Tasks-page store layer (src/lib/task-utils:
 * weekData ledger + tasks), NOT in a parallel kid ledger. PINs are verified
 * server-side (the client bundle never sees member PINs; a typed PIN lives
 * only in component state for the length of one attempt).
 *
 * The rewards LWW stamp helpers are shared with the Tasks page and Settings'
 * RewardSection (see the stamp section at the bottom).
 */
import { loadWeekData } from "@/lib/task-utils";

// weekData.points is keyed by member FULL name; auth may carry a first name.
// Resolve a display name to its ledger key (exact, then first-name match).
export function ledgerKey(points: Record<string, number>, name: string): string | null {
  if (points[name] !== undefined) return name;
  const first = name.split(" ")[0].toLowerCase();
  return Object.keys(points).find((k) => k.split(" ")[0].toLowerCase() === first) ?? null;
}

export function pointsFor(points: Record<string, number>, name: string): number {
  const key = ledgerKey(points, name);
  return key ? points[key] || 0 : 0;
}

export function currentWeekPoints(name: string): { points: number; key: string } {
  const week = loadWeekData();
  const key = ledgerKey(week.points, name) || name;
  return { points: week.points[key] || 0, key };
}

// Same endpoint + semantics as the Tasks page's verifyPinRemote — but the
// outcome is DISCRIMINATED: a network rejection or a 5xx means the server
// never answered, which must never read to a kid as "Wrong PIN" (an asleep
// NAS looked like a mistyped code). Only a 401 is an honest wrong PIN.
// The server-verification contract is unchanged: no client-side comparison.
export type PinVerifyResult =
  | { status: "ok"; member: any }
  | { status: "wrongPin" }
  | { status: "unreachable" };

export async function verifyPinRemote(memberName: string, pin: string): Promise<PinVerifyResult> {
  try {
    const res = await fetch("/api/members/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberName, pin }),
    });
    if (res.status === 401) return { status: "wrongPin" };
    if (!res.ok) return { status: "unreachable" };
    const member = (await res.json()).member ?? null;
    return member ? { status: "ok", member } : { status: "wrongPin" };
  } catch {
    return { status: "unreachable" };
  }
}

// Honest failure copy (mirrors the chat page's offline-vs-server pattern).
export function unreachableCopy(): string {
  return typeof navigator !== "undefined" && !navigator.onLine
    ? "You're offline — check the connection and try again."
    : "Couldn't reach Consuela — check the connection and try again.";
}

// ─── Rewards catalog stamp — delete truth between Settings and Tasks ───────
// The rewards list (task-utils REWARDS_KEY) has TWO writers: Settings'
// RewardSection and the Tasks page. The Tasks page's snapshot restore used to
// adopt the server list whenever it was LONGER — which made a parent's delete
// (a shorter, NEWER list) lose to a stale snapshot and resurrect. A separate
// last-write-wins stamp fixes the heuristic without reshaping the list: every
// user edit touches the stamp, and a restore only adopts a strictly newer
// server stamp. Legacy unstamped snapshots can never win — the delete stands.
export const REWARDS_STAMP_KEY = "consuela-rewards-updatedAt";

export function readRewardsStamp(): string {
  try {
    return localStorage.getItem(REWARDS_STAMP_KEY) || "";
  } catch {
    return "";
  }
}

export function touchRewardsStamp(): string {
  const iso = new Date().toISOString();
  try {
    localStorage.setItem(REWARDS_STAMP_KEY, iso);
  } catch {}
  return iso;
}

// Carry an adopted snapshot's stamp through as the local stamp (the list is
// now this device's truth AS OF that stamp — re-stamping "now" would make a
// no-op refresh look like a fresh local edit and block newer server state).
export function writeRewardsStamp(iso: string): void {
  try {
    localStorage.setItem(REWARDS_STAMP_KEY, iso);
  } catch {}
}
