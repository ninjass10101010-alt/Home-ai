/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import PageShell from "@/components/ui/PageShell";
import Avatar, { type AvatarSize } from "@/components/ui/Avatar";
import WeatherWidget from "@/components/ui/WeatherWidget";
import HomeWidgetIcon from "@/components/ui/HomeWidgetIcon";
import EmergencyButton from "@/components/ui/EmergencyButton";
import ScheduleDisplay from "@/components/ui/ScheduleDisplay";
import { db } from "@/db";
import CurrentMealWidget from "@/components/meals/CurrentMealWidget";
import { AtmosphericProvider, useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";
import AtmosphericBridge from "@/components/ui/AtmosphericBridge";
import { HOLIDAY_PALETTE } from "@/lib/holiday";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useWallMode } from "@/hooks/useWallMode";
import { WIDGET_SPANS, homeGridClass, widgetSpanClass, tabletSpan, tabletSpanFor, HOME_GRID_FALLBACK, WALL_GRID_CLASS, computeWallBoard, visibleOnWallBoard, wallBoardSpanClass, PHONE_WIDGET_FOLD } from "@/lib/layout-config";
import { AnimationBudgetProvider } from "@/components/providers/AnimationBudgetProvider";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import PinModal from "@/components/auth/PinModal";
import WallPinPad from "@/components/wall/WallPinPad";
import PhotosWidget from "@/components/photos/PhotosWidget";
import WallMemberRail from "@/components/wall/WallMemberRail";
import MemberPickerModal from "@/components/auth/MemberPickerModal";
import SoftButton from "@/components/ui/SoftButton";
import ListRow from "@/components/ui/ListRow";
import FamilyStrip from "@/components/home/FamilyStrip";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import ReadStatePill from "@/components/ui/ReadStatePill";
import { classifyReadError, readMessageFor, type ReadFailure } from "@/lib/read-state";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import StatTile from "@/components/patterns/StatTile";
import DayStrip from "@/components/patterns/DayStrip";
import DayLine, { parseTimeToMinutes, useDayFraction } from "@/components/patterns/DayLine";
import SectionCard from "@/components/patterns/SectionCard";
import WidgetCard from "@/components/patterns/WidgetCard";
import HomeLeaderboardWidget from "@/components/leaderboard/HomeLeaderboardWidget";
import HomeSuggestionsWidget from "@/components/suggestions/HomeSuggestionsWidget";
import MorningBriefingWidget from "@/components/briefing/MorningBriefingWidget";
import HomeSecurityWidget from "@/components/ha/HomeSecurityWidget";
import HomeClimateWidget from "@/components/ha/HomeClimateWidget";
import HomeLightsWidget from "@/components/ha/HomeLightsWidget";
import LedgerWidget from "@/components/finance/LedgerWidget";
import MusicWidget from "@/components/music/MusicWidget";
import { useMorningBriefing, briefingShowsCard } from "@/components/briefing/hooks/useMorningBriefing";
import ProfileSheet from "@/components/profile/ProfileSheet";
import { useHomeEvents } from "@/hooks/useHomeEvents";
import { googleEventCoversDay, mapGoogleEvent } from "@/lib/calendar/google-mapping";
import { localTodayISO } from "@/lib/local-date";
import { normalizeAvatarSize } from "@/lib/avatar-size";
import { loadTasks, isPendingApproval, PIN_FREE_MAX_AGE, resolveMemberName } from "@/lib/task-utils";
import WeeklyWinModal from "@/components/leaderboard/WeeklyWinModal";
import MoreSheet, { MoreButton } from "@/components/patterns/MoreSheet";
import { todayMondayISO } from "@/lib/meals-week-utils";
import { useDashboardMode } from "@/hooks/useDashboardMode";

const FogBackground = dynamic(() => import("@/components/ui/FogBackground"), { ssr: false });
// KidHome reads localStorage-backed stores and animates on mount — client-only,
// same dynamic/ssr:false recipe FogBackground uses inside KidHome itself.
const KidHome = dynamic(() => import("@/modes/kid/KidHome"), { ssr: false });

function memberMatchesName(member: any, name: string) {
  const firstName = name.split(" ")[0];
  return (
    member.name === name ||
    member.name.startsWith(`${name} `) ||
    member.name.split(" ")[0] === name ||
    member.name === firstName ||
    firstName.startsWith(member.name)
  );
}

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const QUICK_PROMPTS = [
  "What's running low?",
  "Any calendar conflicts?",
  "What chores are pending?",
];

/**
 * Honest "Week · Days planned" count: distinct weekdays in the given week
 * that carry at least one planned meal. Meals without a `weekOf` predate the
 * week-scoped planner and belong to the current week (same rule useMeals
 * applies). `null` meal data means the read was unavailable (e.g. a guest's
 * blocked gateway read) — the tile renders "—", never a fabricated number.
 */
export function plannedDaysThisWeek(meals: any[] | null, weekOf: string): number | null {
  if (meals === null) return null;
  const days = new Set<string>();
  for (const m of meals) {
    if ((m?.weekOf || weekOf) === weekOf && typeof m?.time === "string" && m.time) days.add(m.time);
  }
  return days.size;
}

/**
 * Morning briefing grid slot. Owns the briefing hook so the widget and the
 * empty-cell decision share one fetch; when there is nothing to show for the
 * day the slot returns null so the bento grid doesn't keep a hollow
 * `lg:col-span-1` cell that pushes every row down.
 */
function MorningBriefingSlot({ span }: { span: string }) {
  const { briefing, loading, ack, ackError, failure, stale, retrying, retry } = useMorningBriefing();
  // A failed read keeps the slot: collapsing it to null is precisely the silent
  // absence audit P0-4 is about — the card would vanish instead of admitting it
  // couldn't load. An empty day (read succeeded, nothing to show) still collapses.
  //
  // Composition with the points remediation: `briefingShowsCard` is consulted
  // ONLY inside `if (!failure)`, so it can never suppress the P0-4 failure
  // card. It widens the non-failure case from "has sections" to "has sections
  // OR has something to admit" — an unavailable or backup chore list renders an
  // honest note instead of a silent "no chores".
  if (loading) return null;
  if (!failure) {
    if (!briefing || !briefingShowsCard(briefing)) return null;
  }
  return (
    <div className={span}>
      <MorningBriefingWidget
        briefing={briefing}
        loading={loading}
        ack={ack}
        ackError={ackError}
        failure={failure}
        stale={stale}
        retrying={retrying}
        onRetry={retry}
        className="h-full"
      />
    </div>
  );
}

// HomeShell — the Home page's shell boundary. Resolves the active holiday at
// the shell and injects the --holiday-* CSS vars Task 3's cards consume, plus
// a data-holiday hook for holiday-scoped CSS. The attribute + a
// display:contents wrapper carry them because PageShell forwards no unknown
// props; `contents` adds no box, so the shell layout is unchanged.
//
// `board` is the landscape wall board (1920×1080). It gets the SAME
// `wall-home-fit` shell as the portrait profile, because the requirement is the
// same one — a glanceable canvas that does not scroll and never sits under the
// dock — and the panel rotated into landscape never sets `data-wall`.
function HomeShell({ children, wall, board, mounted }: { children: ReactNode; wall: boolean; board: boolean; mounted: boolean }) {
  const { holiday, accentColor, glowColor } = useAtmosphericTheme();
  // Mounted-gated like the rest of the date-derived Home chrome: detectAutoHoliday()
  // reads the wall clock, so SSR and client can straddle a window boundary (holiday
  // start/end midnight, UTC-vs-local devices). Server output is always the no-holiday
  // pair; the tint applies on the first client render after mount.
  const activeHoliday = mounted && holiday !== "none" && holiday !== "auto" ? holiday : null;
  const pal = activeHoliday ? HOLIDAY_PALETTE[activeHoliday] : undefined;
  return (
    <div className="contents" data-holiday={activeHoliday ?? undefined}>
      <PageShell
        style={{
          backgroundColor: "transparent",
          ...(pal ? ({ "--holiday-accent": accentColor, "--holiday-glow": glowColor, "--holiday-surface": pal.surfaceTint } as CSSProperties) : {}),
        }}
        contentClassName={wall || board ? "wall-home-fit" : ""}
      >
        {children}
      </PageShell>
    </div>
  );
}

/**
 * The landscape wall board — a wide, short canvas (≥1600 wide and ≤1300 tall).
 *
 * Measured at 1920×1080: Home rendered 2162px of content, so the fixed dock
 * painted over the middle of the third row, and `wall-home-fit`'s flex column
 * could not fix it because the grid's 220px row floor set the grid's own
 * height — `flex: 1 1 auto` cannot shrink a floor, so `main` clipped 360px of
 * its own board instead. Mounted-gated for the same reason `wall` is: the first
 * client render must match the server's, and the server has no viewport.
 */
function useWallBoard(): { board: boolean; mounted: boolean } {
  const [mounted, setMounted] = useState(false);
  const [board, setBoard] = useState(false);
  useEffect(() => {
    setMounted(true);
    const update = () => setBoard(computeWallBoard(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return { board, mounted };
}

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [todayEvents, setTodayEvents] = useState<any[]>([]);
  // Audit P0-4: this was a boolean, which collapsed "Google is disconnected",
  // "the backboard is down" and "no connection" into one line of copy — and the
  // line had no retry, so the only way back was a page reload.
  const [googleTodayFailure, setGoogleTodayFailure] = useState<ReadFailure | null>(null);
  const [googleRetrying, setGoogleRetrying] = useState(false);
  const refreshTodayEventsRef = useRef<() => Promise<void>>(async () => {});
  const googleTodayRef = useRef<any[]>([]);
  const googleTodayRawRef = useRef<any[]>([]);
  const googleTodayColorMapRef = useRef<Record<string, string> | null>(null);
  const googleTodayRequestRef = useRef(0);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [homeScheduleItems, setHomeScheduleItems] = useState<any[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<string>("morning");
  const [season, setSeason] = useState<{ name: string; emoji: string }>({ name: "Spring", emoji: "🌸" });
  const [dateInfo, setDateInfo] = useState<{ dayOfWeek: string; dayMonth: string }>({ dayOfWeek: "---", dayMonth: "---" });
  const [now, setNow] = useState<Date | null>(null);
  const [pinningMember, setPinningMember] = useState<{ name: string; emoji: string; color: string; avatarSize: AvatarSize; glow: boolean } | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Audit 4.5: below-the-fold widgets start folded behind the More… sheet on
  // stacked layouts; expanding is session-only (a reload folds them again).
  const [widgetsExpanded, setWidgetsExpanded] = useState(false);
  // Live roster: db/index.ts dispatches consuela-members-updated whenever the
  // members cache refreshes (60s CacheRefresher pull, patchMemberLocal after a
  // profile save). Bump a version so the family strip re-reads the roster
  // instead of freezing at whatever it held at mount.
  const [membersVersion, setMembersVersion] = useState(0);
  useEffect(() => {
    const onMembersUpdated = () => setMembersVersion(v => v + 1);
    window.addEventListener("consuela-members-updated", onMembersUpdated);
    return () => window.removeEventListener("consuela-members-updated", onMembersUpdated);
  }, []);

  const router = useRouter();
  const { currentUser, isLoggedIn, isParent, logout, sessionRemainingMs, sessionWarning, extendSession, quickLogin } = useAuth();
  const { mode } = useDashboardMode();
  const { visibleWidgets, orientation, mounted: layoutMounted } = useHomeLayout();
  const { wall, mounted: wallMounted } = useWallMode();
  const { board: wideBoard, mounted: boardMounted } = useWallBoard();
  const { upcomingImportant } = useHomeEvents();
  // `wall-composition.test.ts` pins this shape: the RESOLVED WALL PROFILE gates
  // the swap to WALL_GRID_CLASS. Nothing else may take that branch.
  const baseGridClass = wallMounted && wall
    ? WALL_GRID_CLASS
    : layoutMounted
      ? homeGridClass(orientation)
      : HOME_GRID_FALLBACK;
  // The board appends to whichever class it inherited. `wall-widget-grid` is
  // what the canvas-fit CSS hangs the "grid takes the leftover height" rule
  // off, and `wall-board-grid` carries the 4-column / shorter-row scale.
  const boardFit = boardMounted && wideBoard && layoutMounted;
  const gridClass = boardFit ? `${baseGridClass} wall-widget-grid wall-board-grid` : baseGridClass;
  // The Ledger is parents-only — filtered out entirely (not a hollow cell).
  const layoutWidgets = isParent ? visibleWidgets : visibleWidgets.filter((w) => w.id !== "financeLedger");
  // The board shows twelve cells — three rows of four — which is what clears the
  // dock at 1080. The four it drops are the same ambient tail the portrait wall
  // drops, for the same documented reasons (see WALL_BOARD_HIDDEN_WIDGETS); they
  // are hidden, not deleted, and stay switchable in Home settings.
  const homeWidgets = boardFit ? visibleOnWallBoard(layoutWidgets) : layoutWidgets;
  // Audit 4.5: stacked layouts (phone / tablet portrait, never the wall) keep
  // only the ranked first fold rendered; the rest wait behind the More… sheet.
  const foldActive = !wall && layoutMounted && orientation !== "desktop" && homeWidgets.length > PHONE_WIDGET_FOLD;
  const renderedWidgets = foldActive && !widgetsExpanded ? homeWidgets.slice(0, PHONE_WIDGET_FOLD) : homeWidgets;

  const sessionSecondsRemaining = Math.ceil(sessionRemainingMs / 1000);
  const showSessionPill = isLoggedIn && sessionRemainingMs < 30 * 60 * 1000 - 60 * 1000;
  const sessionPillMM = String(Math.floor(sessionSecondsRemaining / 60)).padStart(2, "0");
  const sessionPillSS = String(sessionSecondsRemaining % 60).padStart(2, "0");

  const dashboardCurrentUser = useMemo<AuthUser | null>(() => {
    if (!currentUser) return null;
    const member = db.selectMembersDetailed().find((m: any) => memberMatchesName(m, currentUser.name));
    if (!member) return currentUser;

    return {
      ...currentUser,
      emoji: member.emoji || currentUser.emoji,
      color: member.color || currentUser.color,
      avatarSize: normalizeAvatarSize(member.avatarSize),
      glow: Boolean(member.glow),
    };
  }, [currentUser]);

  // Roster-resolved FULL name for the weekly-win ceremony — hall entries are
  // keyed by full name and the auth name can be a first name (same idiom as
  // the tasks page's raceName). Null for guests: the modal renders nothing.
  const weeklyWinName = useMemo(
    () => (isLoggedIn && currentUser ? resolveMemberName(db.selectMembers(), currentUser.name) : null),
    [isLoggedIn, currentUser]
  );

  // Quiet sign-in feedback toast (PIN-fallback copy) — same 3s auto-dismiss
  // pattern the Meals/Calendar pages use; the session-warning Toast below is
  // an independent open condition.
  const [notification, setNotification] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setNotification(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setNotification(null), 3000);
  };
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  // Under-10 kids: one tap signs in (server still re-verifies; a 403 means
  // the roster was stale and we fall back to the PIN modal — fail safe).
  const isPinFreeChild = (member: { role?: string; age?: number }) =>
    member.role === "child" &&
    typeof member.age === "number" &&
    member.age > 0 &&
    member.age < PIN_FREE_MAX_AGE; // imported from "@/lib/task-utils" — single source

  const handleSignInPick = async (member: any) => {
    setPickerOpen(false);
    if (isPinFreeChild(member)) {
      const r = await quickLogin(member.name);
      if (!r.success) {
        setPinningMember({ name: member.name, emoji: member.emoji || "😊", color: member.color || "green", avatarSize: normalizeAvatarSize(member.avatarSize), glow: member.glow || false });
        showToast("Tap your PIN to sign in.");
      }
      return;
    }
    setPinningMember({ name: member.name, emoji: member.emoji || "😊", color: member.color || "green", avatarSize: normalizeAvatarSize(member.avatarSize), glow: member.glow || false });
  };

  useEffect(() => {
    setMounted(true);
    setNow(new Date());

    const refreshTodayEvents = async () => {
      const requestId = ++googleTodayRequestRef.current;
      setGoogleRetrying(true);
      let family: any[] = [];
      try { family = db.selectTodaysEvents(); } catch {}
      const mapGoogleRows = (rows: any[], colorMap: Record<string, string> | null, todayISO: string) =>
        rows
          .filter((row: any) => googleEventCoversDay(row, todayISO))
          .map((row: any) => mapGoogleEvent(row, colorMap))
          .filter(Boolean);
      let googleToday = mapGoogleRows(
        googleTodayRawRef.current,
        googleTodayColorMapRef.current,
        localTodayISO(),
      );
      try {
        const res = await fetch("/api/google-calendar", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (requestId !== googleTodayRequestRef.current) return;
        if (!res.ok || !data || data.ok === false) {
          googleTodayRef.current = googleToday;
          // The route answers `ok:false` with a real status (401 for a revoked
          // grant, 502 for a partial Google failure), so the status decides; a
          // 200 that still says `ok:false` is the backboard's fault, not ours.
          const authFlavoured = typeof data?.error === "string" && /unauthor|no_grant|not_connected/i.test(data.error);
          setGoogleTodayFailure(authFlavoured ? "unauthorised" : classifyReadError({ status: res.ok ? 502 : res.status }));
        } else {
          const colorMap = data.calendar_colors && typeof data.calendar_colors === "object"
            ? data.calendar_colors as Record<string, string>
            : null;
          googleTodayRawRef.current = Array.isArray(data.events) ? data.events : [];
          googleTodayColorMapRef.current = colorMap;
          googleToday = mapGoogleRows(googleTodayRawRef.current, colorMap, localTodayISO());
          googleTodayRef.current = googleToday;
          setGoogleTodayFailure(null);
        }
      } catch (err) {
        if (requestId === googleTodayRequestRef.current) {
          googleTodayRef.current = googleToday;
          setGoogleTodayFailure(classifyReadError(err));
        }
      }
      if (requestId !== googleTodayRequestRef.current) return;
      setTodayEvents(
        [...family, ...googleToday].sort((a: any, b: any) =>
          (a.time === "All day" ? -1 : parseTimeToMinutes(a.time || "")) -
          (b.time === "All day" ? -1 : parseTimeToMinutes(b.time || ""))
        )
      );
      // A superseded run bailed above; only the live run may clear the spinner.
      setGoogleRetrying(false);
    };
    refreshTodayEventsRef.current = refreshTodayEvents;

    try {
      refreshTodayEvents();

      const today = new Date();
      const hour = today.getHours();
      const tod = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
      setTimeOfDay(tod);

      const month = today.getMonth();
      const nextSeason = month >= 2 && month <= 4 ? { name: "Spring", emoji: "🌸" } : month >= 5 && month <= 7 ? { name: "Summer", emoji: "☀️" } : month >= 8 && month <= 10 ? { name: "Autumn", emoji: "🍂" } : { name: "Winter", emoji: "❄️" };
      setSeason(nextSeason);
      setDateInfo({
        dayOfWeek: today.toLocaleDateString("en-US", { weekday: "short" }),
        dayMonth: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      });
    } catch {
      setHomeError("Consuela could not load your family dashboard.");
    }
    window.addEventListener("consuela-data-refreshed", refreshTodayEvents);
    const onGoogleDisconnected = () => {
      googleTodayRequestRef.current += 1;
      googleTodayRawRef.current = [];
      googleTodayColorMapRef.current = null;
      googleTodayRef.current = [];
      setGoogleTodayFailure("unauthorised");
      setTodayEvents((current) => current.filter((event: any) => event.member !== "Google"));
    };
    window.addEventListener("consuela-google-disconnected", onGoogleDisconnected);
    return () => {
      window.removeEventListener("consuela-data-refreshed", refreshTodayEvents);
      window.removeEventListener("consuela-google-disconnected", onGoogleDisconnected);
    };
  }, []);

  // Tasks + Daily Schedule: the same refresh contract the Week tile uses —
  // re-pull on the 60s `consuela-data-refreshed` pulse so the widgets stop
  // freezing until a manual reload. db.refreshCaches now feeds the tasks
  // snapshot pull into the stores loadTasks() reads, and schedules land in
  // the db cache the same cycle.
  const taskDataLoadedRef = useRef(false);
  useEffect(() => {
    const read = () => {
      try {
        // One task truth: the Tasks page's own store layer (loadTasks — parse,
        // due-date migration, recurring regen, fallback). The old raw
        // localStorage read made Home and /tasks disagree, and the load-time
        // slice(0,3) capped the Tasks stat tile at 3.
        const pending = loadTasks()
          .filter((t: any) => !t.completed)
          .map((t: any) => ({
            id: t.id, title: t.title, assigned: t.assignee, due: t.due,
            points: t.points, priority: t.priority, category: t.category,
          }));
        setPendingTasks(pending);
        // Single pending gate: isPendingApproval is the ONLY pending check.
        setPendingApprovalCount(loadTasks().filter(isPendingApproval).length);

        // Same pattern as tasks: the Daily Schedule widget is visible, so it
        // reads the db store layer (PB-backed cache with fallback + 60s
        // refresh) instead of a raw per-device localStorage key.
        setHomeScheduleItems(db.selectTodaysSchedules());
        taskDataLoadedRef.current = true;
      } catch {
        // A refresh failure keeps whatever the widgets already show — only
        // the very first read can fail the dashboard into the error state.
        if (!taskDataLoadedRef.current) {
          setHomeError("Consuela could not load your family dashboard.");
        }
      }
    };
    read();
    window.addEventListener("consuela-data-refreshed", read);
    return () => window.removeEventListener("consuela-data-refreshed", read);
  }, []);

  // Honest "Week · Days planned" count — the same sessioned read layer the
  // Meals page uses (gatewayReadStatus reports BLOCKED separately from
  // genuinely-empty, so a guest's hidden data renders "—", not "0").
  const [weekPlannedDays, setWeekPlannedDays] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      db.gatewayReadStatus("meal_plan_entries")
        .then(({ items, blocked }) => {
          if (cancelled) return;
          setWeekPlannedDays(
            blocked && items.length === 0 ? null : plannedDaysThisWeek(items, todayMondayISO())
          );
        })
        .catch(() => {
          if (!cancelled) setWeekPlannedDays(null);
        });
    };
    read();
    window.addEventListener("consuela-data-refreshed", read);
    return () => {
      cancelled = true;
      window.removeEventListener("consuela-data-refreshed", read);
    };
  }, []);

  // Family strip roster read — its own effect so the roster re-reads when the
  // members cache refreshes (consuela-members-updated bumps membersVersion)
  // without re-running the clock/schedule/tasks mount logic above.
  useEffect(() => {
    try {
      const members = db.selectMembersDetailed().map((member: any, idx: number) => ({
        name: member.name,
        color: member.color || (idx % 4 === 0 ? "green" : idx % 4 === 1 ? "cyan" : idx % 4 === 2 ? "violet" : "amber"),
        emoji: member.emoji,
        avatarSize: normalizeAvatarSize(member.avatarSize),
        glow: member.glow || false,
        // Sign-in branching inputs (isPinFreeChild). The detailed roster
        // capitalizes roles on the fallback path and carries age as a string
        // (or ""), so normalize here — a missing/unparseable age stays
        // undefined and fails closed to the PIN path.
        role: String(member.role || "").toLowerCase() || undefined,
        age: member.age != null && member.age !== "" && Number.isFinite(Number(member.age)) ? Number(member.age) : undefined,
      }));
      setFamilyMembers(members);
    } catch {
      // Keep whatever the strip already holds — a roster read failure must not
      // blank the family avatars.
    }
  }, [membersVersion]);

  useEffect(() => {
    if (!mounted) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [mounted]);

  const timeStr = now ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "--:--";
  const familyName = isLoggedIn && dashboardCurrentUser ? dashboardCurrentUser.name.split(" ")[0] : "Garcia family";

  const dayFraction = useDayFraction();
  const weekFraction = useMemo(() => {
    if (dayFraction === null) return null;
    const mondayIndex = (new Date().getDay() + 6) % 7;
    return (mondayIndex + dayFraction) / 7;
  }, [dayFraction]);
  const weekDayBoundaries = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({ at: (i + 1) / 7 })),
    []
  );
  const eventLineColor = (event: any): string =>
    event?.colorHex ||
    (event?.color === "green" ? "var(--color-accent-mint)"
    : event?.color === "violet" ? "var(--color-accent-violet)"
    : event?.color === "amber" ? "var(--color-accent-amber)"
    : event?.color === "cyan" ? "var(--color-accent-cyan)"
    : event?.color === "rose" ? "var(--color-accent-rose)"
    : "var(--color-accent-nori)");

  const weekDays = useMemo(() => {
    if (!mounted) {
      return weekdayLabels.map((label) => ({ id: label, label, detail: undefined, active: false }));
    }
    const today = new Date();
    const todayLabel = weekdayLabels[today.getDay()];
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(today);
      day.setDate(today.getDate() + index - today.getDay());
      const label = weekdayLabels[day.getDay()];
      const mealsForDay = (db.mealsStore || []).filter((meal: any) => meal.time === label);
      return {
        id: label,
        label,
        detail: String(day.getDate()),
        active: label === todayLabel,
        accent: mealsForDay.length > 0 ? "var(--color-accent-sage)" : undefined,
      };
    });
  }, [mounted]);

  // Kid mode (child/pet signed in) gets the gamified KidHome instead of the
  // family bento. Family/adult rendering below is untouched.
  if (mode === "kid") {
    return <KidHome />;
  }

  if (homeError) {
    return (
      <PageShell>
        <EmergencyButton />
        <ErrorState title="Dashboard unavailable" description={homeError} retryLabel="Reload" onRetry={() => window.location.reload()} />
      </PageShell>
    );
  }

  return (
      <AtmosphericProvider>
        <AnimationBudgetProvider>
        <FogBackground />
        <HomeShell wall={wall} board={wideBoard} mounted={mounted}>
          <EmergencyButton />

          {/* The header band. `wall-board-header` tightens its vertical padding on the
              board: that band's whole budget is "rows that clear the dock", and
              36px of top padding plus 20px of bottom padding is 56px of it spent
              on air (measured 271px of header against a 692px grid area). */}
          <div className={`relative z-10 px-4 pb-5 pt-7 sm:pt-9${boardFit ? " wall-board-header" : ""}`}>
            {/* ── The header band ────────────────────────────────────────────
                From `xl` the greeting (left) and the KPI row (right) share ONE
                horizontal band. Stacked, a 1920 wall spent 430px of its 968px
                canvas on a 175px header plus a three-across KPI row whose cards
                were 619px wide each holding a single digit — and still only
                showed 1.6 rows of the bento. Side by side the canvas carries
                content and the grid gets ~200px of height back. */}
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between xl:gap-10">
              <div className="min-w-0 xl:max-w-[46%]">
                {/* Row 1 — the date, and the identity rail.
                    The rail carries its OWN `pr-14/16` clearance for the fixed
                    Emergency shield. That reservation used to sit on the whole
                    row, so the greeting inherited it: measured 139px of
                    measure at 390 and 69px at 320, which is how "AUTUMN · SAT,"
                    / "OCT 3 — 11:48 PM" split mid-value and "Rebecca" broke
                    to "Rebec / a". */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  {/* One value, one run. `truncate` is the belt to the
                      `whitespace` the flex row already gives it: the date may
                      never wrap into two lines, and it never may squeeze the
                      rail off the row. */}
                  <p className="order-1 min-w-0 flex-1 truncate whitespace-nowrap text-eyebrow">
                    {dateInfo.dayOfWeek} · {dateInfo.dayMonth}
                  </p>
                  <div className="order-2 ml-auto flex shrink-0 items-center gap-2 pr-14 sm:pr-16">
                    {wall ? (
                      <WallMemberRail
                        members={familyMembers}
                        currentUser={dashboardCurrentUser}
                        isLoggedIn={isLoggedIn}
                        onPick={handleSignInPick}
                        onSelfProfile={() => setProfileOpen(true)}
                        onSignOut={logout}
                      />
                    ) : isLoggedIn && dashboardCurrentUser ? (
                      <>
                        {showSessionPill && (
                          <span
                            className={`rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-2.5 py-1 text-xs font-semibold tabular-nums text-text-secondary backdrop-blur-xl ${
                              sessionWarning ? "session-pill-warning border-[var(--color-accent-amber)]/30 bg-[var(--color-accent-amber)]/10 text-[var(--color-accent-amber)]" : ""
                            }`}
                            aria-label={`Auto sign-out in ${sessionPillMM}:${sessionPillSS}`}
                            title="Time until auto sign-out"
                          >
                            ⏳ {sessionPillMM}:{sessionPillSS}
                          </span>
                        )}
                        {/* Sign out is glyph-only and exactly 44×44. The
                            labelled pill measured 95×30 — under the house floor
                            on the axis that matters — and its 143px label was
                            most of what squeezed the greeting at phone widths.
                            It is a secondary action, not a headline. */}
                        <button
                          type="button"
                          onClick={() => setConfirmingLogout(true)}
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 bg-[var(--color-surface-0)]/55 text-text-secondary backdrop-blur-xl transition hover:bg-[var(--color-surface-0)]/75 hover:text-text-primary active:scale-95"
                          aria-label="Sign out"
                          title="Sign out"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
                            <path d="M9 21H5a2 2 0 0 1 -2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                        </button>
                        {/* 44×44 hit box around the 40px avatar — the button
                            itself was the avatar, so it inherited a 40px
                            target. */}
                        <button
                          type="button"
                          onClick={() => setProfileOpen(true)}
                          className="grid h-11 w-11 shrink-0 place-items-center transition-transform active:scale-90"
                          aria-label="Open your profile"
                        >
                          <Avatar name={dashboardCurrentUser.name} color={dashboardCurrentUser.color} emoji={dashboardCurrentUser.emoji} size={normalizeAvatarSize(dashboardCurrentUser.avatarSize)} variant="emoji" glow={dashboardCurrentUser.glow} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="min-h-11 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-[var(--color-surface-0)]/35 px-3 py-1.5 text-xs font-semibold text-text-secondary backdrop-blur-xl transition hover:bg-[var(--color-surface-0)]/55 hover:text-text-primary active:scale-95"
                        aria-label="Sign in"
                        title="Sign in"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
                          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-4" />
                          <polyline points="10 17 15 12 10 7" />
                          <line x1="15" y1="12" x2="3" y2="12" />
                        </svg>
                        <span>Sign in</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Row 2 — the hero. Owns the full measure at every width. The
                    clock stays adjacent to the name rather than pushed to the
                    far edge: `justify-between` stranded it ~190px from
                    "Rebecca" at 390 and ~400px at 768, so it read as a stray
                    label rather than the time of that greeting. */}
                <div className="mt-1 flex items-end gap-3">
                  <h1 className={`text-display min-w-0 text-[2rem] text-text-primary sm:text-[2.6rem] xl:text-[3.25rem]${boardFit ? " wall-board-greeting" : ""}`}>
                    Good {timeOfDay},{boardFit ? " " : <br />}
                    <span className="text-[var(--color-accent-selected)]">{familyName}</span>
                  </h1>
                  {/* The season + clock, right-anchored to the greeting's
                      baseline. The clock used to live in the eyebrow, where a
                      per-second value in tracked 12px caps was the least
                      settled element on the page — and it is what pushed the
                      date onto two lines. */}
                  <p className="shrink-0 whitespace-nowrap pb-1 text-eyebrow tabular-nums">
                    {season.emoji} {timeStr}
                  </p>
                </div>

                {/* Row 3 — the family roster. The wall profile withdraws it in
                    favour of its own rail; the board keeps it, because the rail's
                    self-label is sized for the wall's 14px type floor and truncates
                    to "✓ Rebe…" at the board's phone-size type, and a roster with a
                    truncated name on it is worse than a roster that costs 76px. */}
                {!wall && (
                  <FamilyStrip
                    className="mt-5"
                    members={familyMembers}
                    isSelf={(name) => Boolean(isLoggedIn && dashboardCurrentUser && memberMatchesName(dashboardCurrentUser, name))}
                    onSelect={(member) => handleSignInPick(member)}
                    onSelfProfile={() => setProfileOpen(true)}
                    onAddMember={!isLoggedIn ? () => router.push("/settings") : undefined}
                  />
                )}
              </div>

              {/* The KPI band. Three tiles, one baseline, calm tones — the
                  greeting is the hero and the weather card is the loudest
                  object on the page; the stat row must not out-shout either.
                  The Events tile carries NO progress hairline: `dayFraction`
                  rendered as "99%" directly under "Events · Today", which
                  reads as a share of the day's events rather than a clock. */}
              <div className="grid grid-cols-3 gap-3 sm:gap-4 xl:w-[52%] xl:max-w-[1180px] xl:shrink-0">
                <StatTile label={todayEvents.length === 1 ? "Event" : "Events"} value={todayEvents.length} detail="Today" icon={<HomeWidgetIcon variant="events" size="sm" />} tone={todayEvents.length > 0 ? "warning" : "accent"} compact wide progress={null} />
                <StatTile label="Tasks" value={pendingTasks.length} detail="Pending" icon={<HomeWidgetIcon variant="tasks" size="sm" />} tone={pendingTasks.length > 0 ? "danger" : "success"} compact wide />
                {/* No progress hairline, same reasoning as the Events tile above:
                    `progress` draws a percentage numeral under the label, and
                    "Week · Days planned · 0%" made this the only tile with a
                    THREE-line right column — so it grew past the two tiles it
                    shares a baseline with and the band stopped reading as three
                    equal tiles. The count already IS the fraction. */}
                <StatTile label="Week" value={weekPlannedDays === null ? "—" : weekPlannedDays} detail="Days planned" icon={<HomeWidgetIcon variant="week" size="sm" />} tone="accent" compact wide progress={null} />
              </div>
            </div>
          </div>

          {/* The bento gets its OWN wrapper, and the week strip + action row
              live in a sibling after it. Under `wall-home-fit` the grid area is
              the flex child that grows, so keeping the tail inside it meant the
              grid could never claim the space the tail was holding: measured at
              1920×1080 the grid area was 692px and the grid itself 337px — and
              the 220px row floor, which `flex` cannot shrink, then clipped 360px
              of the board. Out here the tail keeps its own space and the grid
              gets everything the dock leaves.
              Everywhere else these are plain blocks, so `mt-6` + `space-y-6`
              reproduce exactly the spacing the single wrapper used to give. */}
          <div className="wall-home-grid-area px-4 relative z-10">
            {/* `EmptyState`'s inside-card reserve is `min-h-56` — 224px of held
                air for one line of copy. On a phone that single card pushed the
                whole first fold past the second widget. The wall profile
                already overrides the reserve with a higher-specificity rule, so
                this only relaxes the stacked layouts. */}
            <div className={`${gridClass} [&_[data-empty-state]]:min-h-0`}>

            {/* Audit 4.5: stacked layouts render `renderedWidgets` — the ranked
                first fold only; the rest wait behind the More… sheet. */}
            {renderedWidgets.map((w, index) => {
              const id = w.id;
              const span = boardFit
                ? wallBoardSpanClass(id)
                : layoutMounted
                  ? orientation === "tablet"
                    ? tabletSpanFor(id, index, renderedWidgets)
                    : widgetSpanClass(id, orientation)
                  : (WIDGET_SPANS[id] ?? "lg:col-span-1");
              switch (id) {
                case "morningBriefing":
                  return <MorningBriefingSlot key="morningBriefing" span={span} />;

                case "weather":
                  return (
                    <div key="weather" className={`relative z-10 ${span}`}>
                      <WeatherWidget className="h-full" />
                      <AtmosphericBridge />
                    </div>
                  );

                case "leaderboard":
                  return <div key="leaderboard" className={span}><HomeLeaderboardWidget className="h-full" /></div>;

                case "consuelaSuggestions":
                  return <div key="consuelaSuggestions" className={span}><HomeSuggestionsWidget className="h-full" /></div>;

                case "todayEvents": {
                  // The wall's 3×4 grid gives every card ~250px; three events
                  // plus the "upcoming" sub-list measured 121px past the card
                  // box and was sliced off mid-row. A wall is read at a glance:
                  // two events, with the remainder still counted in the footer.
                  const visibleEvents = todayEvents.slice(0, wall ? 2 : 3);
                  const hiddenEvents = todayEvents.length - visibleEvents.length;
                  const upcoming = !wall && Array.isArray(upcomingImportant) ? upcomingImportant.slice(0, 2) : [];
                  return (
                    <div key="todayEvents" className={span}>
                      <SectionCard title="Today" description={`${todayEvents.length} ${todayEvents.length === 1 ? "event" : "events"} on the family calendar`} icon={<HomeWidgetIcon variant="events" size="lg" />} tone="#3b82f6" compact centeredHeader headingLevel="h2" className="h-full"
                        footer={
                          hiddenEvents > 0 ? (
                            <Link href="/calendar" className="tap-sm text-xs font-semibold widget-accent-text">+{hiddenEvents} more · See all →</Link>
                          ) : undefined
                        }>
                        {googleTodayFailure && (
                          <div className="mb-2">
                            <ReadStatePill
                              state={googleTodayFailure}
                              subject="Google Calendar"
                              message={readMessageFor(googleTodayFailure, todayEvents.length > 0)}
                              retrying={googleRetrying}
                              onRetry={() => void refreshTodayEventsRef.current()}
                            />
                          </div>
                        )}
                        <div className="min-h-0 flex-1 overflow-y-auto">
                        <DayLine
                          className="mb-3"
                          tone="#3b82f6"
                          markers={todayEvents
                            .filter((event: any) => typeof event?.time === "string" && /\d{1,2}:\d{2}/.test(event.time))
                            .map((event: any) => ({ at: parseTimeToMinutes(event.time), color: eventLineColor(event) }))}
                        />
                        {visibleEvents.length === 0 ? (
                          <EmptyState title="Quiet day" description="No events are scheduled for today." icon="🌿" flat />
                        ) : (
                          <div className="space-y-2">
                            {visibleEvents.map((event) => (
                              <ListRow
                                key={event.id}
                                title={event.title}
                                subtitle={event.time}
                                leftRailColor={eventLineColor(event)}
                                leading={<span className="text-xl">{event.icon}</span>}
                                trailing={event.member ? (
                                  <span
                                    className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                    style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${eventLineColor(event)} 55%, transparent), color-mix(in srgb, ${eventLineColor(event)} 30%, transparent))` }}
                                  >
                                    {String(event.member).split(" ")[0]}
                                  </span>
                                ) : undefined}
                              />
                            ))}
                          </div>
                        )}
                        {upcoming.length > 0 && (
                          <div className="pt-3 border-t border-white/10">
                            <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Upcoming important</div>
                            <div className="space-y-2">
                              {upcoming.map((event: any) => {
                                const timeStr = event.time
                                  ? (() => {
                                      try {
                                        if (typeof event.time === "string" && event.time.includes("M")) return event.time;
                                        return new Date(`2000-01-01T${event.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                                      } catch {
                                        return String(event.time);
                                      }
                                    })()
                                  : "";
                                const dateLabel = event.date ? String(event.date).slice(0, 10) : (event.start ? String(event.start).slice(0, 10) : "");
                                const subtitle = [dateLabel, timeStr].filter(Boolean).join(" · ");
                                const memberLabel = event.member ? String(event.member).split(" ")[0] : null;
                                return (
                                  <ListRow
                                    key={event.id}
                                    title={event.title}
                                    subtitle={subtitle || undefined}
                                    leftRailColor={eventLineColor(event)}
                                    leading={<span className="text-xl">{event.icon || "📅"}</span>}
                                    trailing={memberLabel ? (
                                      <span
                                        className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                        style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${eventLineColor(event)} 55%, transparent), color-mix(in srgb, ${eventLineColor(event)} 30%, transparent))` }}
                                      >
                                        {memberLabel}
                                      </span>
                                    ) : undefined}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}
                        </div>
                      </SectionCard>
                    </div>
                  );
                }

                case "schedule":
                  return (
                    <div key="schedule" className={span}>
                      <ScheduleDisplay schedule={homeScheduleItems} title="Daily Schedule" className="h-full" />
                    </div>
                  );

                case "currentMeal":
                  return (
                    <div key="currentMeal" className={span}>
                      <AtmosphericProvider>
                        <CurrentMealWidget className="h-full" />
                      </AtmosphericProvider>
                    </div>
                  );

                case "tasks": {
                  const visibleTasks = pendingTasks.slice(0, 3);
                  const hiddenTasks = pendingTasks.length - visibleTasks.length;
                  return (
                    <div key="tasks" className={span}>
                      <SectionCard title="Tasks" description={`${pendingTasks.length} pending for the family`} icon={<HomeWidgetIcon variant="tasks" size="lg" />} tone="#f43f5e" compact centeredHeader headingLevel="h2" className="h-full"
                        footer={
                          isParent && pendingApprovalCount > 0 ? (
                            <Link href="/tasks" className="tap-sm text-xs font-semibold widget-accent-text">{pendingApprovalCount} need approval →</Link>
                          ) : hiddenTasks > 0 ? (
                            <Link href="/tasks" className="tap-sm text-xs font-semibold widget-accent-text">+{hiddenTasks} more · See all →</Link>
                          ) : undefined
                        }>
                        {visibleTasks.length === 0 ? (
                          <EmptyState title="All caught up" description="No pending tasks right now." icon="🎉" flat />
                        ) : (
                          <div className="space-y-2">
                            <DayLine tone="#f43f5e" />
                            {visibleTasks.map((task, idx) => {
                              const pointsColor = task.points > 15 ? "var(--color-accent-rose)" : task.points > 10 ? "var(--color-accent-amber)" : "var(--color-accent-mint)";
                              const subtitle = [task.assigned, task.due].filter(Boolean).join(" · ");
                              return (
                                <div
                                  key={task.id}
                                  className="schedule-row liquid-glass flex items-center gap-3 px-3 py-2.5 animate-in"
                                  style={{
                                    animationDelay: `${idx * 0.05}s`,
                                    backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${pointsColor} 40%, transparent) 0%, color-mix(in srgb, ${pointsColor} 20%, transparent) 100%)`,
                                  }}
                                >
                                  <div
                                    className="h-8 w-0.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: pointsColor, boxShadow: `0 0 8px ${pointsColor}` }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm text-text-primary">{task.title}</div>
                                    {subtitle && <div className="truncate text-xs text-text-secondary">{subtitle}</div>}
                                  </div>
                                  <span
                                    className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold text-text-primary glass-subtle"
                                    style={{
                                      background: `linear-gradient(135deg, color-mix(in srgb, ${pointsColor} 55%, transparent), color-mix(in srgb, ${pointsColor} 30%, transparent))`,
                                    }}
                                  >
                                    +{task.points}pts
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </SectionCard>
                    </div>
                  );
                }

                case "homeSecurity":
                  return <div key="homeSecurity" className={span}><HomeSecurityWidget className="h-full" /></div>;

                case "homeClimate":
                  return <div key="homeClimate" className={span}><HomeClimateWidget className="h-full" /></div>;

                case "homeLights":
                  return <div key="homeLights" className={span}><HomeLightsWidget className="h-full" /></div>;

                case "aiQuickAsk":
                  // Was a bare `WidgetCard`, the only tile in the bento with no
                  // header band: the badge hung off the corner with nothing beside
                  // it and the body floated in the middle of an empty box. It is
                  // a `SectionCard centeredHeader` now, so it carries the same
                  // ruled title band as Consuela suggests / This Week's
                  // Leaderboard / Daily Schedule and the grid reads as one row.
                  return (
                    <div key="aiQuickAsk" className={span}>
                      <SectionCard
                        title="Quick ask"
                        description="Send a question to Consuela"
                        icon={<HomeWidgetIcon variant="ask" size="lg" />}
                        tone="#8b5cf6"
                        compact
                        centeredHeader
                        headingLevel="h2"
                        className="h-full"
                      >
                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
                          <Link
                            href="/chat"
                            className="tap-sm hit-44 inline-flex items-center gap-1.5 text-sm font-semibold widget-accent-text"
                          >
                            &ldquo;Add soccer practice for Thursday.&rdquo;
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                          <div className="flex flex-wrap items-center justify-center gap-1.5">
                            {/* The board's rows are 184px and the three chips wrap to a
                                third line at 463px wide, which pushed the last chip 19px
                                out of the card. Two chips is one line; Ask is one tap away
                                either way, so nothing is lost. */}
                            {(boardFit ? QUICK_PROMPTS.slice(0, 2) : QUICK_PROMPTS).map((prompt) => (
                              <Link
                                key={prompt}
                                href={`/chat?q=${encodeURIComponent(prompt)}`}
                                className="tap-sm rounded-full border border-[var(--color-accent-violet)]/25 bg-[var(--color-accent-violet)]/10 px-2.5 py-1 text-xs font-semibold widget-accent-text transition-colors hover:bg-[var(--color-accent-violet)]/20"
                              >
                                {prompt}
                              </Link>
                            ))}
                          </div>
                        </div>
                      </SectionCard>
                    </div>
                  );

                case "financeLedger":
                  return <div key="financeLedger" className={span}><LedgerWidget className="h-full" /></div>;

                case "music":
                  // Hidden on the wall by default (layout-config's tablet
                  // hidden list); when switched on it renders like any other
                  // 1x1 card.
                  return <div key="music" className={span}><MusicWidget /></div>;

                case "photos":
                  // Full-bleed tile: no WidgetCard wrapper, because the photo is
                  // the card. On the wall the span resolves to row-span-2.
                  return <div key="photos" className={span}><PhotosWidget className="h-full" /></div>;

                default:
                  return null;
              }
            })}
            </div>
          </div>

{/* The tail: the week's rhythm and the three board actions. Neither survives
              the board, and the reason is the same for both — they are the two
              sparsest objects on Home.
              - The action row's three destinations (Meals, Tasks, More…) are the
                dock's, 94px below, permanently.
              - The week strip answered a question the header band's "Week · Days
                planned" tile already answers with a number, and at 1888px wide
                its seven day circles occupied 400px of it. It also cost a whole
                grid row: withdrawing it took the bento from three rows of 184px
                to three rows of 249px — the same row height the portrait wall
                uses — which is what stopped "Home Security" printing its footer
                over its own sensor chips.
              Both are one tap from Home's More… sheet and their own routes, so
              nothing becomes unreachable. */}
          {!boardFit && (
          <div className="wall-home-tail px-4 mt-6 space-y-6 relative z-10">
            <SectionCard title="This Week" description="Meal and family rhythm at a glance" icon={<HomeWidgetIcon variant="week" size="lg" />} tone="#10b981" compact headingLevel="h2">
              <DayStrip value="today" onChange={(dayId) => router.push(`/meals?day=${dayId}`)} days={weekDays} compact />
              <DayLine className="mt-3" mode="week" tone="#10b981" progress={weekFraction} markers={weekDayBoundaries} />
            </SectionCard>

            {/* `whitespace-nowrap` on all three labels. `SoftButton` is a flex
                row with `gap-2` and no width constraint of its own, so a label
                with a space in it is the first thing to break when the row
                tightens: "Plan Meals" and "Open Tasks" wrapped to two lines
                while the single-token "More…" could not, and the row ended up
                with two double-height buttons and one short one. */}
            <div className="flex gap-3">
                <Link href="/meals" className="min-w-0 flex-1">
                  <SoftButton variant="secondary" className="w-full whitespace-nowrap">Plan Meals</SoftButton>
                </Link>
                <Link href="/tasks" className="min-w-0 flex-1">
                  <SoftButton className="w-full whitespace-nowrap">Open Tasks</SoftButton>
                </Link>
              <MoreButton className="min-w-0 flex-1 whitespace-nowrap" onClick={() => setMoreOpen(true)} />
            </div>
          </div>
          )}

          {/* Home More… sheet — keeps /grocery, /skill-tree, /time-capsule,
              /analytics, /money-mountain and /memory reachable (audit P1-5). */}
          <MoreSheet
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            extraItems={
              foldActive
                ? [
                    {
                      key: "widgets",
                      title: widgetsExpanded ? "Show fewer widgets" : "Show all widgets",
                      description: widgetsExpanded
                        ? `Back to the first ${PHONE_WIDGET_FOLD}`
                        : `${homeWidgets.length - PHONE_WIDGET_FOLD} more below the fold`,
                      badge: widgetsExpanded ? undefined : String(homeWidgets.length - PHONE_WIDGET_FOLD),
                      icon: <span className="text-xl" aria-hidden="true">🧩</span>,
                      onSelect: () => {
                        setWidgetsExpanded((v) => !v);
                        setMoreOpen(false);
                      },
                    },
                  ]
                : undefined
            }
          />

          <MemberPickerModal
            open={pickerOpen}
            members={familyMembers}
            onClose={() => setPickerOpen(false)}
            onSelect={handleSignInPick}
          />

          {wall && pinningMember ? (
            <WallPinPad
              member={{ name: pinningMember.name, emoji: pinningMember.emoji }}
              onClose={() => setPinningMember(null)}
              onSuccess={() => setPinningMember(null)}
            />
          ) : pinningMember ? (
            <PinModal
              memberName={pinningMember.name}
              memberEmoji={pinningMember.emoji}
              memberColor={pinningMember.color}
              onClose={() => setPinningMember(null)}
              onSuccess={() => setPinningMember(null)}
            />
          ) : null}

          {isLoggedIn && dashboardCurrentUser && (
            <ProfileSheet
              open={profileOpen}
              onClose={() => setProfileOpen(false)}
              member={dashboardCurrentUser}
            />
          )}

          {/* Weekly-win ceremony. On the wall display the family view stays
              ceremony-free — only kid mode mounts it there (KidHome). */}
          {!wall && <WeeklyWinModal memberName={weeklyWinName} />}

          {isLoggedIn && (
            <Modal
              open={confirmingLogout}
              onClose={() => setConfirmingLogout(false)}
              title={`Sign out of ${dashboardCurrentUser?.name.split(" ")[0] || "your account"}?`}
              description="You can sign back in any time by tapping your avatar."
              footer={
                <>
                  <SoftButton variant="secondary" className="flex-1" onClick={() => setConfirmingLogout(false)}>
                    Cancel
                  </SoftButton>
                  <SoftButton
                    className="flex-1"
                    onClick={() => {
                      setConfirmingLogout(false);
                      logout();
                    }}
                  >
                    Sign out
                  </SoftButton>
                </>
              }
            >
              {dashboardCurrentUser && (
                <div className="flex items-center gap-3">
                  <Avatar
                    name={dashboardCurrentUser.name}
                    color={dashboardCurrentUser.color}
                    emoji={dashboardCurrentUser.emoji}
                    size="md"
                    variant="emoji"
                    glow={dashboardCurrentUser.glow}
                  />
                  <span className="text-sm text-text-secondary">
                    Signed in as <span className="font-semibold text-text-primary">{dashboardCurrentUser.name}</span>
                  </span>
                </div>
              )}
            </Modal>
          )}

          <Toast
            open={isLoggedIn && sessionWarning}
            tone="neutral"
          >
            <button
              type="button"
              onClick={extendSession}
              className="flex w-full items-center justify-center gap-2 text-left"
              aria-label="Stay signed in"
            >
              <span>You’ll be signed out in {sessionSecondsRemaining}s — tap to stay</span>
            </button>
          </Toast>

          <Toast open={Boolean(notification)} tone="neutral">
            {notification}
          </Toast>
        </HomeShell>
        </AnimationBudgetProvider>
      </AtmosphericProvider>
  );
}
