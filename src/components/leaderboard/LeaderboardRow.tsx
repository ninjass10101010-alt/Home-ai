"use client";

import Surface from "@/components/ui/Surface";
import Avatar from "@/components/ui/Avatar";
import IconButton from "@/components/ui/IconButton";
import RankArrow from "./RankArrow";
import { entryLevelLabel, PROGRESS_UNAVAILABLE_LABEL } from "./level";

interface LeaderboardRowProps {
  entry: any;
  /**
   * DEPRECATED — a positional index, kept only so existing call sites keep
   * compiling. It was never a rank: rows 4+ are handed `index + 3`, so the
   * `index === 0/1/2` medal branches below could not fire and the badge
   * printed `#${index + 1}` — a POSITION. The visible rank now comes from
   * `entry.rank` (standard competition ranking), the same number the row's
   * RankArrow and YourCard use. Drop this prop and the call site's
   * `index={index + 3}` when convenient; nothing here reads it.
   */
  index?: number;
  previousRank: number | undefined;
  isYou: boolean;
  getMemberColor: (name: string) => string;
  onAdjust: (name: string) => void;
  onOpenSheet: (name: string) => void;
  isAdmin: boolean;
}

/** The sheet is a real control, so a keypress inside ANOTHER control (the
 *  admin adjust button) must not also open it. The row's own box is
 *  `currentTarget` and is never "inner". */
function isFromInnerControl(target: EventTarget | null, self: EventTarget | null): boolean {
  if (!target || target === self) return false;
  return !!(target as HTMLElement).closest?.("button, a, input, select, textarea, [role='button'], [role='link']");
}

export default function LeaderboardRow({
  entry,
  previousRank,
  isYou,
  getMemberColor,
  onAdjust,
  onOpenSheet,
  isAdmin,
}: LeaderboardRowProps) {
  const color = getMemberColor(entry.name);
  const openSheet = () => onOpenSheet(entry.name);
  const known = !!entry.levelKnown;
  // The percentage moved OUT of this string and onto the progress bar's own row:
  // concatenated with the level name it measured ~120px and wrapped, orphaning
  // "46%" onto a line of its own under the bar.
  const levelLine = known
    ? entryLevelLabel(entry)
    : PROGRESS_UNAVAILABLE_LABEL;

  return (
    <Surface
      variant="glass-subtle"
      radius="xl"
      padding="sm"
      className={`cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)] ${isYou ? "widget-row-glow" : ""}`}
      style={isYou ? { "--row-color": color } as React.CSSProperties : undefined}
      // Rows 4+ open the member sheet, so this row IS a button: it needs a
      // role, a tab stop, an accessible name and Enter/Space — the same
      // treatment PodiumSlot already gave the podium (the tap-target contract
      // only scans `role="button"`, which is why a div-onClick slipped past).
      role="button"
      tabIndex={0}
      aria-label={`${entry.name}: ${entry.points} points, rank ${entry.rank}`}
      onClick={openSheet}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (isFromInnerControl(e.target, e.currentTarget)) return;
        e.preventDefault();
        openSheet();
      }}
    >
      {/* gap-2 + a 32px rank chip (was gap-3 + 40px) hands ~30px back to the
          middle column. At 390 the row has exactly five columns competing, and
          the name was being truncated to "Aur…" while the level line wrapped
          and orphaned "46%" onto a line of its own. */}
      <div className="flex items-center gap-1.5">
        <div className="relative grid h-8 w-8 shrink-0 place-items-center">
          {/* The rank is `entry.rank` — standard competition ranking, so a tie
              prints the rank it SHARES (two members tied 3rd both read #3 and
              nobody is given the #4 that belongs to no one). The podium owns
              the medals; this row is always rank 4 or lower in the sort. */}
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--color-accent-selected)]/10 text-xs font-bold text-text-secondary display-numeral">
            #{entry.rank}
          </div>
        </div>
        <Avatar name={entry.name} color={color} emoji={entry.emoji} size="sm" variant="emoji" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-text-primary">{entry.name.split(" ")[0]}</span>
            {isYou && (
              /* The roster colour is a CSS keyword ("green", "cyan", …) and was
                 the TEXT colour here: `color: green` measured 1.87:1 in dark and
                 3.48:1 in light, both under AA. Identity rides the tinted chip
                 and the row glow; the glyph uses the primary ink. */
              <span
                className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-text-primary"
                style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}
              >
                You
              </span>
            )}
            <span className="shrink-0 text-xs" aria-hidden>{entry.levelKnown ? entry.levelEmoji : "❔"}</span>
            {entry.badges.length > 0 && (
              <span className="flex shrink-0 gap-0.5">
                {entry.badges.slice(0, 3).map((b: string, i: number) => (
                  <span key={i} className="text-xs animate-badge-sparkle" style={{ animationDelay: `${i * 0.3}s` }}>
                    {b}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap">
            {entry.streak > 0 && (
              <span className="truncate text-xs text-[var(--color-accent-ink-amber)] font-semibold">🔥 {entry.streak}d streak</span>
            )}
            {entry.streak === 0 && entry.points > 0 && (
              <span className="truncate text-xs text-text-muted" title="Complete a task today!">Complete a task today!</span>
            )}
            {entry.points === 0 && <span className="truncate text-xs text-text-muted italic" title="No tasks yet this week">No tasks yet…</span>}
            <span className="ml-auto shrink-0"><RankArrow currentRank={entry.rank} previousRank={previousRank} /></span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
              {/* A KNOWN zero is drawn as zero: a member sitting exactly on a
                  level threshold has no progress to show. The `levelKnown`
                  branch already suppressed the UNKNOWN case (never 0 for
                  unknown) — this is the same class of mistake for the known
                  zero, so no 2px stub bar is drawn either. */}
              {known && entry.progressToNext > 0 && (
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-selected)]/60 to-[var(--color-accent-selected)] transition-all duration-700 ease-out animate-progress-fill"
                  style={{ width: `${entry.progressToNext}%` }}
                />
              )}
            </div>
            {known && (
              <span className="shrink-0 text-xs text-text-muted display-numeral">
                {entry.progressToNext >= 100 ? "MAX" : `${entry.progressToNext}%`}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-text-muted" title={levelLine}>
            {levelLine}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-text-primary display-numeral">{entry.points}</div>
          <div className="text-xs text-text-muted">pts</div>
        </div>
        {isAdmin && (
          <IconButton size="sm" variant="ghost" aria-label={`Adjust points for ${entry.name}`} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onAdjust(entry.name); }}>
            ⚙️
          </IconButton>
        )}
      </div>
    </Surface>
  );
}
