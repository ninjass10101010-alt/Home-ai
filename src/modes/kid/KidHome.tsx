/* eslint-disable react-hooks/set-state-in-effect */
/**
 * KidHome — The "Personal Adventure"
 *
 * Fun, colorful, gamified dashboard for kids.
 *
 * Features:
 *   - Hero avatar (large, animated, center-stage)
 *   - Level bar with XP progress + level-up celebrations
 *   - Tasks as "Quests" — an under-10 kid's tap on an ASSIGNED quest
 *     completes it PIN-free as done-but-unpaid (pending parent approval);
 *     a 10+ kid confirms with their PIN first, and the verified completion
 *     still lands pending — points never post locally. Points land only when
 *     a parent approves on the Tasks page. Universal/stealable quests keep
 *     the server-side claim gate (/api/tasks/claim) for every age.
 *   - Positive leaderboard framing ("YOU'RE #1!")
 *   - Bedtime mode (no quests, sweet dreams)
 *   - Weekend mode (bonus quests)
 *   - Spring-bounce easing on all interactions
 *
 * Data truth: points/streaks/quests all read the Tasks-page store layer
 * (src/lib/task-utils loadTasks/loadWeekData) — never a parallel ledger.
 */
"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import PageShell from "@/components/ui/PageShell";
import Avatar from "@/components/ui/Avatar";
import EmergencyButton from "@/components/ui/EmergencyButton";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";
import { AtmosphericProvider } from "@/hooks/useAtmosphericTheme";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardMode } from "@/hooks/useDashboardMode";
import { useWallMode } from "@/hooks/useWallMode";
import WallPinPad from "@/components/wall/WallPinPad";
import Surface from "@/components/ui/Surface";
import Link from "next/link";
import { db } from "@/db";
import {
  loadTasks,
  saveTasks,
  loadWeekData,
  saveWeekData,
  addTransaction,
  weekKey,
  getThisWeeksCompletedTasks,
  getThisWeeksCompletedDates,
  calculateRealStreak,
  syncTasksToPB,
  syncWeekDataToPB,
  completesWithoutPin,
  completesWithPendingApproval,
  tapCompletePending,
  isSnatchable,
  resolveMemberName,
} from "@/lib/task-utils";
import QuestCard from "./QuestCard";
import LevelBar from "./LevelBar";
import CelebrationBurst from "./CelebrationBurst";
import KidProfileSheet from "@/components/modes/kid/KidProfileSheet";
import { ledgerKey, pointsFor, currentWeekPoints, unreachableCopy, verifyPinRemote } from "./kid-store";
import SpotifyWidget from "@/components/integrations/SpotifyWidget";
import AllowanceWidget from "@/components/integrations/AllowanceWidget";
import LearningWidget from "@/components/integrations/LearningWidget";

const FogBackground = dynamic(() => import("@/components/ui/FogBackground"), { ssr: false });

const POINTS_PER_LEVEL = 50;

// ─── Kid Leaderboard (positive framing) ─────────────────────────────────────

function KidLeaderboard({ members }: { members: { name: string; color: string; emoji: string; points: number; streak: number }[] }) {
  const { currentUser } = useAuth();
  const myFirstName = currentUser?.name?.split(" ")[0] || "";

  const sorted = [...members].sort((a, b) => (b.points || 0) - (a.points || 0));
  const myRank = sorted.findIndex((m) => m.name?.split(" ")[0] === myFirstName) + 1;
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Surface variant="warm" radius="2xl" padding="none" aria-live="polite" aria-label="Family leaderboard">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h3 className="text-base font-bold text-text-primary">🏆 Leaderboard</h3>
        <span className="text-[11px] font-semibold text-text-muted">This week</span>
      </div>
      <div className="px-4 pb-4 space-y-2">
        {sorted.slice(0, 5).map((member, i) => {
          const isMe = member.name?.split(" ")[0] === myFirstName;
          return (
            <div
              key={member.name}
              className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-all"
              style={{
                background: isMe
                  ? "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 18%, transparent), rgba(255,255,255,0.06))"
                  : "rgba(255,255,255,0.04)",
                border: isMe
                  ? "2px solid var(--color-accent-selected)"
                  : "1px solid rgba(255,255,255,0.06)",
                boxShadow: isMe ? "0 0 20px color-mix(in srgb, var(--color-accent-selected) 12%, transparent)" : "none",
              }}
            >
              <span className="text-lg shrink-0 w-7 text-center">
                {i < 3 ? medals[i] : `${i + 1}`}
              </span>
              <Avatar
                name={member.name}
                color={member.color || "green"}
                emoji={member.emoji || "😊"}
                size="sm"
                variant="emoji"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-text-primary truncate">
                  {member.name?.split(" ")[0]}
                </span>
                {isMe && (
                  <span
                    className="ml-1.5 text-[11px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md inline-block align-middle"
                    style={{ background: "var(--color-accent-button, var(--color-accent-selected))", color: "white" }}
                  >
                    You!
                  </span>
                )}
                {member.streak > 0 && (
                  <span className="ml-1 text-xs text-[var(--color-accent-amber)]">🔥{member.streak}d</span>
                )}
              </div>
              <span className="text-sm font-bold text-text-primary tabular-nums">
                {member.points || 0}
              </span>
              <span className="text-[11px] text-text-muted">pts</span>
            </div>
          );
        })}

        {/* Positive reinforcement */}
        <div className="pt-2 text-center">
          {myRank === 1 ? (
            <p className="text-sm font-bold text-[var(--color-accent-amber)]">🎉 You&apos;re in the lead! Keep it up!</p>
          ) : myRank === 2 ? (
            <p className="text-xs text-text-secondary">
              So close! <span className="text-[var(--color-accent-selected)] font-semibold">You can take #1!</span>
            </p>
          ) : myRank > 0 ? (
            <p className="text-xs text-text-secondary">
              You&apos;re #{myRank} — <span className="text-[var(--color-accent-selected)] font-semibold">you can do it!</span>
            </p>
          ) : (
            <p className="text-xs text-text-muted">Complete quests to climb the ranks!</p>
          )}
        </div>
      </div>
    </Surface>
  );
}

// ─── Bedtime View ───────────────────────────────────────────────────────────

function BedtimeView({ firstName, pointsToday }: {
  firstName: string;
  pointsToday: number;
}) {
  return (
    <div className="px-4 space-y-5 relative z-10 pb-8">
      {/* Good night message */}
      <Surface variant="warm" radius="2xl" padding="lg">
        <div className="text-center py-2">
          <span className="text-5xl block mb-3">🌙</span>
          <h2 className="text-xl font-bold text-text-primary">
            Great job today, {firstName}!
          </h2>
          <p className="text-sm text-text-secondary mt-2">
            You earned <span className="font-bold text-[var(--color-accent-amber)]">{pointsToday} points</span> today!
          </p>
          <p className="text-sm text-text-secondary mt-4">
            Sweet dreams! See you tomorrow 💤
          </p>
          <div className="mt-3 flex items-center justify-center gap-2 text-2xl">
            <span className="floating" style={{ animationDelay: "0s" }}>🌟</span>
            <span className="floating" style={{ animationDelay: "0.5s" }}>⭐</span>
            <span className="floating" style={{ animationDelay: "1s" }}>✨</span>
            <span className="floating" style={{ animationDelay: "1.5s" }}>💤</span>
          </div>
        </div>
      </Surface>

      {/* Bedtime Music — auto-plays lullabies via Spotify */}
      <div className="mt-4">
        <SpotifyWidget />
      </div>

      {/* Tomorrow preview */}
      <div>
        <h3 className="text-base font-bold text-text-primary mb-3">📋 Tomorrow</h3>
        <Surface variant="warm" radius="2xl" padding="none">
          <div className="p-4">
            <p className="text-xs text-text-secondary">Consuela will show tomorrow&apos;s plans here in the morning.</p>
          </div>
        </Surface>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function KidHome() {
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [completedToday, setCompletedToday] = useState<any[]>([]);
  const [todayEvents, setTodayEvents] = useState<any[]>([]);
  const [members, setMembers] = useState<{ name: string; color: string; emoji: string; points: number; streak: number }[]>([]);
  const [points, setPoints] = useState(0);
  const [pointsToday, setPointsToday] = useState(0);
  const [streak, setStreak] = useState(0);
  const [tonightMeal, setTonightMeal] = useState<any>(null);
  const [celebration, setCelebration] = useState<{ points: number; leveledUp: boolean; newLevel: number; pending?: boolean } | null>(null);
  // Quest PIN gate — the typed PIN lives in this component's state only and
  // is cleared after every attempt (never persisted).
  const [questPinTask, setQuestPinTask] = useState<any | null>(null);
  const [questPin, setQuestPin] = useState("");
  const [questPinError, setQuestPinError] = useState("");
  const [questPinBusy, setQuestPinBusy] = useState(false);
  // Live roster: bump a version on consuela-members-updated so the leaderboard
  // re-reads the roster when the members cache refreshes.
  const [membersVersion, setMembersVersion] = useState(0);
  // Re-read the task/points store after a completion (and on cross-device
  // refreshes) so quests, points, and the leaderboard stay honest.
  const [dataVersion, setDataVersion] = useState(0);
  // Kid profile sheet (tap the hero avatar) — shared by bedtime + normal flows.
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);

  const { currentUser, logout } = useAuth();
  const { isBedtime, isWeekend } = useDashboardMode();
  // Wall profile (spec §6 amendment): on the wall the quest PIN gate renders
  // the WallPinPad keypad instead of the shared typed-input Modal, and the
  // hero gains a kid-visible Switch-member control. Bedtime keeps its calm
  // surface — no switcher.
  const { wall } = useWallMode();

  useEffect(() => {
    const onMembersUpdated = () => setMembersVersion(v => v + 1);
    const onDataRefreshed = () => setDataVersion(v => v + 1);
    window.addEventListener("consuela-members-updated", onMembersUpdated);
    window.addEventListener("consuela-data-refreshed", onDataRefreshed);
    return () => {
      window.removeEventListener("consuela-members-updated", onMembersUpdated);
      window.removeEventListener("consuela-data-refreshed", onDataRefreshed);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setTodayEvents(db.selectTodaysEvents());

        // Load tonight's dinner for the fun widget
        const allMeals = await db.selectMeals();
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const todayName = dayNames[new Date().getDay()];
        const dinner = allMeals.find((m: any) => m.time === todayName && m.mealType === "dinner") || allMeals.find((m: any) => m.mealType === "dinner");
        if (dinner) setTonightMeal(dinner);
      } catch {}
    })();
  }, [dataVersion]);

  // Quests + points + streak: the Tasks page's store layer (loadTasks /
  // loadWeekData), filtered to this kid. The old parallel localStorage
  // ledger (consuela-points-*) was fake data nothing else read — gone.
  useEffect(() => {
    if (!currentUser) return;
    try {
      const myFirst = currentUser.name.split(" ")[0].toLowerCase();
      const isMine = (name?: string) =>
        !!name && (name.toLowerCase() === currentUser.name.toLowerCase() || name.split(" ")[0].toLowerCase() === myFirst);

      const tasks = loadTasks();
      setPendingTasks(tasks.filter((t: any) => !t.completed && (t.universal || isMine(t.assignee))));
      const doneToday = getThisWeeksCompletedTasks(tasks).filter(
        (t: any) => t.completedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10) && isMine(t.completedBy || t.assignee)
      );
      setCompletedToday(doneToday);
      setPointsToday(doneToday.reduce((sum: number, t: any) => sum + (t.points || 0), 0));

      const week = loadWeekData();
      setPoints(pointsFor(week.points, currentUser.name));
      const key = ledgerKey(week.points, currentUser.name) || currentUser.name;
      setStreak(calculateRealStreak(key, week, getThisWeeksCompletedDates(tasks, key)));
    } catch {}
  }, [currentUser, dataVersion, membersVersion]);

  // Leaderboard roster read — its own effect so consuela-members-updated
  // (membersVersion) re-reads the roster without replaying the loads above.
  useEffect(() => {
    try {
      const week = loadWeekData();
      const tasks = loadTasks();
      const memberList = db.selectMembersDetailed().map((m: any) => ({
        name: m.name,
        color: m.color || "green",
        emoji: m.emoji,
        points: pointsFor(week.points, m.name),
        streak: calculateRealStreak(m.name, week, getThisWeeksCompletedDates(tasks, m.name)),
      }));
      setMembers(memberList);
    } catch {}
  }, [membersVersion, dataVersion]);

  const user = currentUser;
  const firstName = user?.name?.split(" ")[0] || "Buddy";
  const level = Math.floor(points / POINTS_PER_LEVEL) + 1;

  // Wall pad identity (spec §6 amendment): the pad header shows the quest's
  // assignee (or the signed-in kid) with their roster emoji/color — never the
  // hardcoded green. Resolved from the live roster snapshot.
  const padMember = (() => {
    const rawName = questPinTask?.assignee || user?.name || "Buddy";
    const first = (v: string) => v.split(" ")[0].toLowerCase();
    const roster = members.find((m) => first(m.name) === first(rawName));
    return {
      name: roster?.name || rawName,
      emoji: roster?.emoji || user?.emoji || "😊",
      color: roster?.color || user?.color || "green",
    };
  })();

  // Display-only celebration (same precedent as the Tasks page): reads the
  // before-snapshot points to decide the level-up flourish — it never posts
  // anything. `pending` marks a done-but-UNPAID completion: the copy says
  // "on the way" and no level-up fires, because until a parent approves the
  // points were never earned.
  const celebrate = useCallback((earned: number, before: number, options?: { pending?: boolean }) => {
    const pending = options?.pending === true;
    const after = before + earned;
    const oldLevel = Math.floor(before / POINTS_PER_LEVEL) + 1;
    const newLevel = Math.floor(after / POINTS_PER_LEVEL) + 1;
    const leveledUp = !pending && newLevel > oldLevel;
    setCelebration({ points: earned, leveledUp, newLevel: leveledUp ? newLevel : 0, pending });
    setTimeout(() => setCelebration(null), 1500);
  }, []);

  // Tap a quest. Under-10 kids skip the gate entirely on ASSIGNED quests
  // (one tap → pending approval, same shape as the Tasks page); everyone else
  // opens the shared server-verified PIN gate. Nothing is completed until the
  // PIN succeeds (or the PIN-free tap lands its pending row).
  const openQuestPin = useCallback((task: any) => {
    if (!user) return;
    // Under-10 kids: one tap on an assigned quest completes it PIN-free —
    // pending approval, same shape as the Tasks page (no PIN modal, no round trip).
    if (completesWithoutPin(user?.role, user?.age, task) && !task.universal && !isSnatchable(task)) {
      // Stale-cache double-tap guard (same trap-proof order as the Tasks
      // page): a row already completed this week lands nothing, not even a
      // second pending stamp.
      if (task.completedInWeek === weekKey()) return;
      const now = new Date().toISOString();
      const myName = resolveMemberName(db.selectMembers(), user!.name);
      const week = loadWeekData();
      const before = pointsFor(week.points, myName);
      const tasks = loadTasks().map((t: any) => (t.id === task.id ? tapCompletePending(t, myName, now, weekKey()) : t));
      saveTasks(tasks);
      void syncTasksToPB(tasks);
      celebrate(task.points || 0, before, { pending: true });
      setDataVersion((v) => v + 1);
      return;
    }
    // 10+ kids (and age-unknown sessions — completesWithoutPin fails closed)
    // keep the PIN modal; submitQuestPin verifies the PIN (predicate:
    // completesWithPendingApproval) and lands PENDING, never a local earn.
    // Universal/snatchable claims of any age land here too — claims are
    // always PIN-gated (server-authoritative route).
    setQuestPinTask(task);
    setQuestPin("");
    setQuestPinError("");
  }, [user, celebrate]);

  const closeQuestPin = useCallback(() => {
    setQuestPinTask(null);
    setQuestPin("");
    setQuestPinError("");
  }, []);

  // The ONE quest-completion body, parameterized by the typed PIN — shared by
  // the non-wall Modal path (submitQuestPin) and the wall WallPinPad path
  // (runQuestCompletion's onVerify wrapper). No duplicated claim/verify
  // branches: wrong-PIN / claim-lost / unreachable outcomes surface as the
  // same strings on both surfaces.
  const runQuestCompletion = useCallback(
    async (questPin: string): Promise<{ ok: boolean; error?: string }> => {
      if (!questPinTask || !user) return { ok: false, error: "Couldn't complete it — try again." };
      // Double-completion guard (same as the Tasks page): a stale local cache
      // row already completed this week must never re-POST or re-award points.
      if (questPinTask.completedInWeek === weekKey()) {
        setQuestPinTask(null);
        setQuestPin("");
        setQuestPinError("");
        return { ok: true };
      }
      setQuestPinBusy(true);
      const task = questPinTask;
      try {
        // Competitive completions (universal claims AND stealable-late snatches)
        // keep the server-authoritative claim route — the same branch the Tasks
        // page uses, so both surfaces agree for every task shape.
        if (task.universal || isSnatchable(task)) {
          // Server-authoritative claim (same route the Tasks page uses):
          // exactly one family member wins the race, points land on the server.
          const before = currentWeekPoints(user.name).points;
          const claimNow = new Date().toISOString();
          const res = await fetch("/api/tasks/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskId: task.id,
              claimantName: user.name,
              claimantPin: questPin,
              completedAt: claimNow,
              title: task.title,
              points: task.points,
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.success) {
            const err =
              res.status === 401 ? "Wrong PIN. Try again."
                : res.status === 409 && data?.claimedBy ? `🤝 ${String(data.claimedBy).split(" ")[0]} already grabbed that one!`
                : res.status === 409 ? "That task was already claimed."
                : "Couldn't claim it — try again.";
            setQuestPinError(err);
            setQuestPin("");
            return { ok: false, error: err };
          }
          if (data?.weekData?.weekStart === weekKey()) saveWeekData(data.weekData);
          // Mirror the claim route's server-side completion fields on the local
          // row — syncTasksToPB writes completedInWeek/completedAt as-is, so a
          // bare { completed: true } would WIPE the server's completion fields.
          const claimantIsChild = user?.role === "child";
          const tasks = loadTasks().map((t: any) =>
            t.id === task.id
              // claimedBy is the server-normalized FULL name (same as the
              // non-universal branch's verified.name) — a first name here
              // would split the ledger key. A kid claimant mirrors the route's
              // pendingApproval answer: done-but-unpaid, NO local earn tx (the
              // route never touched week_data); points land on parent approval.
              ? claimantIsChild
                ? tapCompletePending(t, data?.claimedBy || user.name, claimNow, weekKey())
                : { ...t, completed: true, completedBy: data?.claimedBy || user.name, completedAt: claimNow, completedInWeek: weekKey() }
              : t
          );
          saveTasks(tasks);
          void syncTasksToPB(tasks);
          // A kid claim is done-but-UNPAID (the route held the earn for parent
          // approval) — the celebration copy must say "on the way".
          celebrate(task.points || 0, before, { pending: claimantIsChild });
        } else if (completesWithPendingApproval(user?.role, task)) {
          // 10+ kids (and age-unknown sessions, which fail closed to this gate):
          // the typed PIN is verified server-side FIRST — a wrong or unreachable
          // PIN lands nothing. A verified child's success then completes
          // immediately as done-but-unpaid (same shape as the under-10 tap):
          // points move only on parent approval. The ledger key is the
          // roster-resolved FULL name of the VERIFIED member (db.selectMembers
          // maps name → first name + fullName), the same key approve credits —
          // a raw session first name would split the ledger.
          const result = await verifyPinRemote(task.assignee || user.name, questPin);
          if (result.status !== "ok") {
            const err = result.status === "unreachable" ? unreachableCopy() : "Wrong PIN. Try again.";
            setQuestPinError(err);
            setQuestPin("");
            return { ok: false, error: err };
          }
          if (result.member?.role !== "child") {
            // KidHome is the child surface — a non-child verified record here
            // means the shapes disagree; say so instead of faking success.
            const err = "Couldn't complete it — try again.";
            setQuestPinError(err);
            setQuestPin("");
            return { ok: false, error: err };
          }
          const now = new Date().toISOString();
          const currentWeek = weekKey();
          const myName = resolveMemberName(db.selectMembers(), result.member?.name || user.name);
          const week = loadWeekData();
          const before = pointsFor(week.points, myName);
          const tasks = loadTasks().map((t: any) =>
            t.id === task.id ? tapCompletePending(t, myName, now, currentWeek) : t
          );
          saveTasks(tasks);
          void syncTasksToPB(tasks);
          celebrate(task.points || 0, before, { pending: true });
        } else {
          // Neither branch owns this shape (a non-child session somehow reached
          // the kid gate) — say so instead of faking a success cleanup.
          const err = "Couldn't complete it — try again.";
          setQuestPinError(err);
          setQuestPin("");
          return { ok: false, error: err };
        }
        setQuestPinTask(null);
        setQuestPin("");
        setDataVersion(v => v + 1);
        return { ok: true };
      } catch {
        // Network rejection (offline / NAS asleep) escaped the onClick before:
        // the spinner stopped and the kid got NO feedback with the typed PIN
        // still in state. Honest copy + clear the PIN.
        const err = unreachableCopy();
        setQuestPinError(err);
        setQuestPin("");
        return { ok: false, error: err };
      } finally {
        setQuestPinBusy(false);
      }
    },
    [questPinTask, user, celebrate]
  );

  const submitQuestPin = async () => {
    if (!questPinTask || !user || questPinBusy || questPin.length < 4) return;
    await runQuestCompletion(questPin);
  };

  // Wall pad wrapper: the WallPinPad's onVerify seam feeds the typed code
  // into the SAME completion body. The pad owns dot-clearing; the busy/cancel
  // Modal wiring is not needed here.
  const questPadVerify = useCallback(
    (pin: string) => runQuestCompletion(pin),
    [runQuestCompletion]
  );

  // Greeting based on mode
  const greeting = isBedtime
    ? `🌙 Great job today, ${firstName}!`
    : isWeekend
      ? `🏖️ Weekend Adventure, ${firstName}!`
      : `Hey ${firstName}! 👋`;

  const subtitle = isBedtime
    ? "Sweet dreams! See you tomorrow 💤"
    : isWeekend
      ? "Bonus quests available today! 🎉"
      : `You have ${pendingTasks.length} quest${pendingTasks.length !== 1 ? "s" : ""} today!`;

  const questPinModal = (
    <Modal
      open={questPinTask !== null}
      onClose={closeQuestPin}
      title="Confirm it's you"
      description={questPinTask ? `Enter your PIN to complete "${questPinTask.title}"` : ""}
      footer={
        <>
          <SoftButton variant="secondary" className="flex-1" onClick={closeQuestPin}>
            Cancel
          </SoftButton>
          <SoftButton
            className="flex-1"
            loading={questPinBusy}
            disabled={questPin.length < 4 || questPinBusy}
            onClick={submitQuestPin}
          >
            Complete
          </SoftButton>
        </>
      }
    >
      <div className="space-y-3">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={questPin}
          onChange={(e) => {
            setQuestPin(e.target.value.replace(/\D/g, ""));
            setQuestPinError("");
          }}
          onKeyDown={(e) => { if (e.key === "Enter") submitQuestPin(); }}
          aria-label="Your 4-digit PIN"
          className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
        />
        {questPinError && <p className="text-xs text-[var(--color-accent-rose)]" role="alert">{questPinError}</p>}
      </div>
    </Modal>
  );

  // ── BEDTIME MODE ──
  if (isBedtime) {
    return (
      <AtmosphericProvider>
        <FogBackground />
        <PageShell style={{ backgroundColor: "transparent" }}>
          <EmergencyButton />

          {/* Hero (bedtime) */}
          <div className="relative z-10 px-4 pt-8 pb-2 flex flex-col items-center text-center">
            <button
              type="button"
              onClick={() => setProfileSheetOpen(true)}
              aria-label="Open your profile"
              className="avatar-hero mb-3 tap"
            >
              <Avatar
                name={user?.name || "Buddy"}
                color={user?.color || "green"}
                emoji={user?.emoji || "😊"}
                size="lg"
                variant="emoji"
                glow
              />
            </button>
            <h1 className="text-xl font-bold text-text-primary">{greeting}</h1>
          </div>

          <BedtimeView firstName={firstName} pointsToday={pointsToday} />
        </PageShell>
        <KidProfileSheet
          open={profileSheetOpen}
          onClose={() => setProfileSheetOpen(false)}
          member={{
            name: user?.name || "Buddy",
            color: user?.color || "green",
            emoji: user?.emoji || "😊",
            avatarSize: user?.avatarSize,
            glow: user?.glow,
          }}
          points={points}
        />
      </AtmosphericProvider>
    );
  }

  // ── NORMAL / WEEKEND MODE ──
  return (
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: "transparent" }}>
        <EmergencyButton />

        {/* Celebration overlay — fires only AFTER a PIN-verified completion */}
        {celebration && (
          <CelebrationBurst
            points={celebration.points}
            leveledUp={celebration.leveledUp}
            newLevel={celebration.newLevel}
            pending={celebration.pending}
            onComplete={() => setCelebration(null)}
          />
        )}

        {/* ── Hero Section ── */}
        <div className="relative z-10 px-4 pt-8 pb-4 flex flex-col items-center text-center">
          {/* Big animated avatar — tap opens the kid profile sheet */}
          <button
            type="button"
            onClick={() => setProfileSheetOpen(true)}
            aria-label="Open your profile"
            className="avatar-hero mb-3 tap"
          >
            <Avatar
              name={user?.name || "Buddy"}
              color={user?.color || "green"}
              emoji={user?.emoji || "😊"}
              size="lg"
              variant="emoji"
              glow
            />
          </button>

          {/* Greeting */}
          <h1 className="text-xl font-bold text-text-primary">{greeting}</h1>
          <p className="text-sm text-text-secondary mt-1">{subtitle}</p>

          {/* Level bar */}
          <div className="w-full max-w-xs mt-4">
            <LevelBar points={points} pointsPerLevel={POINTS_PER_LEVEL} />
          </div>

          {/* Streak */}
          {streak > 0 && (
            <div className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "color-mix(in srgb, var(--color-accent-amber) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--color-accent-amber) 20%, transparent)" }}>
              <span className="text-lg">🔥</span>
              <span className="text-sm font-bold text-[var(--color-accent-amber)] tabular-nums">{streak}-day streak!</span>
            </div>
          )}

          {/* Weekend badge */}
          {isWeekend && (
            <div className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full weekend-badge" style={{ background: "color-mix(in srgb, var(--color-accent-amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--color-accent-amber) 15%, transparent)" }}>
              <span className="text-sm">🏖️</span>
              <span className="text-xs font-bold text-[var(--color-accent-amber)]">Weekend Bonus Quests!</span>
            </div>
          )}

          {/* Profile hint / wall Switch-member (spec §6 amendment) */}
          {wall ? (
            <button
              type="button"
              onClick={logout}
              aria-label="Switch member"
              className="tap mt-4 flex min-h-[56px] items-center gap-2 rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-6 text-base font-semibold text-text-secondary hover:bg-[var(--color-surface-0)]/55 hover:text-text-primary"
            >
              🔄 Switch member
            </button>
          ) : (
            <p className="mt-3 text-[11px] text-text-muted">
              Tap your picture to make it yours
            </p>
          )}
        </div>

        {/* ── Content ── */}
        <div className="px-4 space-y-5 relative z-10 pb-8">
          {/* Weekend Bonus Quests */}
          {isWeekend && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-text-primary">🏖️ Weekend Bonus!</h2>
                <span className="text-[11px] font-bold text-[var(--color-accent-amber)]">Double points today!</span>
              </div>
              <Surface variant="warm" radius="2xl" padding="none">
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-12 h-12 rounded-2xl grid place-items-center text-2xl shrink-0"
                      style={{
                        background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-amber) 20%, transparent), color-mix(in srgb, var(--color-accent-amber) 10%, transparent))",
                        border: "1px solid color-mix(in srgb, var(--color-accent-amber) 25%, transparent)",
                      }}
                    >
                      🌟
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-text-primary">Weekend Challenge</h3>
                      <p className="text-[11px] text-text-secondary">Do something fun with the family!</p>
                    </div>
                    <div
                      className="shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-2xl"
                      style={{
                        background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-amber) 15%, transparent), transparent)",
                        border: "1px solid color-mix(in srgb, var(--color-accent-amber) 20%, transparent)",
                      }}
                    >
                      <span className="text-lg font-black tabular-nums text-[var(--color-accent-amber)]">+25</span>
                      <span className="text-[11px] text-text-muted font-bold -mt-0.5">pts</span>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted text-center">
                    Ask a parent to approve your weekend adventure!
                  </p>
                </div>
              </Surface>
            </div>
          )}

          {/* Quests */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-text-primary">
                🎯 Your Quests
              </h2>
              <Link href="/tasks" className="text-[11px] font-semibold text-[var(--color-accent-selected)]">
                View all →
              </Link>
            </div>

            {pendingTasks.length === 0 ? (
              <Surface variant="warm" radius="2xl" padding="lg">
                <div className="text-center py-4">
                  <span className="text-4xl mb-3 block">🎉</span>
                  <h3 className="text-base font-bold text-text-primary">All quests complete!</h3>
                  <p className="text-sm text-text-secondary mt-1">You&apos;re a superstar! Check back later for new ones.</p>
                </div>
              </Surface>
            ) : (
              <div className="space-y-2.5">
                {pendingTasks.map((task) => (
                  <QuestCard key={task.id} task={task} onComplete={openQuestPin} />
                ))}
              </div>
            )}
          </div>

          {/* Completed today */}
          {completedToday.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-text-muted mb-2">
                ✅ Done today ({completedToday.length})
              </h2>
              <div className="space-y-1.5">
                {completedToday.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl opacity-50"
                    style={{
                      background: "color-mix(in srgb, var(--color-accent-mint) 5%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--color-accent-mint) 10%, transparent)",
                    }}
                  >
                    <span className="text-sm">✅</span>
                    <span className="text-xs text-text-muted line-through flex-1">{task.title}</span>
                    <span className="text-[11px] font-bold text-[var(--color-accent-mint)]">+{task.points}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What's Happening */}
          {todayEvents.length > 0 && (
            <div>
              <h2 className="text-base font-bold text-text-primary mb-3">🎪 What&apos;s Happening</h2>
              <Surface variant="warm" radius="2xl" padding="none">
                <div className="p-4 space-y-2">
                  {todayEvents.map((event) => (
                    <div key={event.id} className="flex items-center gap-3 py-1.5">
                      <span className="text-xl">{event.icon || "📅"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary">{event.title}</p>
                        <p className="text-[11px] text-text-secondary">{event.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Surface>
            </div>
          )}

          {/* Tonight's Dinner */}
          {tonightMeal && (
            <div>
              <h2 className="text-base font-bold text-text-primary mb-3">🍽️ Tonight&apos;s Dinner</h2>
              <Surface variant="warm" radius="2xl" padding="none">
                <div className="p-5 text-center">
                  <span className="text-5xl block mb-2">{tonightMeal.emoji || "🍽️"}</span>
                  <h3 className="text-lg font-bold text-text-primary">{tonightMeal.name}</h3>
                  {tonightMeal.prepTime && (
                    <p className="text-xs text-text-secondary mt-1">Ready in {tonightMeal.prepTime} ⏱️</p>
                  )}
                  {tonightMeal.tags && tonightMeal.tags.length > 0 && (
                    <div className="flex justify-center gap-1.5 mt-2">
                      {tonightMeal.tags.map((tag: string) => (
                        <span key={tag} className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--color-text-secondary)" }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Surface>
            </div>
          )}

          {/* Leaderboard */}
          <KidLeaderboard members={members} />

          {/* Spotify Music Widget */}
          <SpotifyWidget />

          {/* Learning Goals */}
          <LearningWidget />

          {/* Allowance — Convert points to cash */}
          <AllowanceWidget />

          {/* Action buttons */}
          <div className="flex gap-3">
            <Link href="/chat" className="flex-1">
              <SoftButton variant="secondary" className="w-full text-base py-4">
                💬 Ask Consuela
              </SoftButton>
            </Link>
            <Link href="/rewards" className="flex-1">
              <SoftButton variant="secondary" className="w-full text-base py-4">
                🏪 Reward Shop
              </SoftButton>
            </Link>
          </div>
        </div>

        {/* Wall (spec §6 amendment): the 10+ quest PIN moves to the WallPinPad
            keypad via the onVerify seam — the pad never signs the member in.
            The shared typed-input Modal stays the non-wall surface. */}
        {!wall && questPinModal}
        {wall && questPinTask && (
          <WallPinPad
            member={padMember}
            onClose={closeQuestPin}
            onSuccess={closeQuestPin}
            onVerify={questPadVerify}
          />
        )}

        {/* Kid profile sheet — the hero avatar tap target (bedtime renders its own). */}
        <KidProfileSheet
          open={profileSheetOpen}
          onClose={() => setProfileSheetOpen(false)}
          member={{
            name: user?.name || "Buddy",
            color: user?.color || "green",
            emoji: user?.emoji || "😊",
            avatarSize: user?.avatarSize,
            glow: user?.glow,
          }}
          points={points}
        />
      </PageShell>
    </AtmosphericProvider>
  );
}
