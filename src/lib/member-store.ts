/**
 * Shared member points & PIN verification helpers — one truth with the Tasks page.
 *
 * Points/streaks live in the Tasks-page store layer (src/lib/task-utils:
 * weekData ledger + tasks), NOT in a parallel ledger. PINs are verified
 * server-side (the client bundle never sees member PINs; a typed PIN lives
 * only in component state for the length of one attempt).
 *
 * The rewards LWW stamp helpers are shared with the Tasks page and Settings'
 * RewardSection.
 */
import { loadWeekData } from "@/lib/task-utils";

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

export function unreachableCopy(): string {
  return typeof navigator !== "undefined" && !navigator.onLine
    ? "You're offline — check the connection and try again."
    : "Couldn't reach Consuela — check the connection and try again.";
}

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

export function writeRewardsStamp(iso: string): void {
  try {
    localStorage.setItem(REWARDS_STAMP_KEY, iso);
  } catch {}
}
