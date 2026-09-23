"use client";

/**
 * KidCrewBoard — KidHome's "🤝 Join a crew!" + "🫳 Up for grabs" board.
 *
 * Presentation only: it renders what `kid-board.ts` classifies and calls the
 * parent's `onAct` (KidHome's existing `openQuestPin`), so joining, checking in
 * and grabbing reuse the server-authoritative /api/tasks/claim actions. Rows
 * carry the shared `.quest-card` class for kid/wall sizing + press motion.
 */
import Avatar from "@/components/ui/Avatar";
import {
  kidBoardState,
  crewAvatars,
  crewProgressLabel,
  crewWaitingNames,
  type BoardRosterMember,
} from "./kid-board";

interface KidCrewBoardProps {
  crews: any[];
  open: any[];
  roster: BoardRosterMember[];
  memberName: string;
  onAct: (task: any) => void;
}

const MINT = "var(--color-accent-mint)";
const CYAN = "var(--color-accent-cyan)";
const AMBER = "var(--color-accent-amber)";

const first = (v?: string | null) => (v || "").trim().split(" ")[0].toLowerCase();

export default function KidCrewBoard({ crews, open, roster, memberName, onAct }: KidCrewBoardProps) {
  if (crews.length === 0 && open.length === 0) return null;

  return (
    <div className="space-y-5" data-testid="kid-crew-board">
      {crews.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-text-primary mb-3">🤝 Join a crew!</h2>
          <div className="space-y-2.5">
            {crews.map((task) => (
              <CrewRow key={task.id} task={task} roster={roster} memberName={memberName} onAct={onAct} />
            ))}
          </div>
        </section>
      )}

      {open.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-text-primary mb-3">🫳 Up for grabs</h2>
          <div className="space-y-2.5">
            {open.map((task) => (
              <OpenRow key={task.id} task={task} onAct={onAct} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EmojiTile({ emoji, tone }: { emoji?: string; tone: string }) {
  return (
    <div
      className="w-11 h-11 rounded-2xl grid place-items-center text-2xl shrink-0"
      style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)` }}
    >
      {emoji || "🎯"}
    </div>
  );
}

function AvatarCluster({ task, roster, memberName }: { task: any; roster: BoardRosterMember[]; memberName: string }) {
  const avatars = crewAvatars(task, roster);
  const total = typeof task.crewSize === "number" ? task.crewSize : avatars.length;
  const emptySlots = Math.max(0, total - avatars.length);
  return (
    <div className="flex items-center" aria-hidden="true">
      {avatars.map((a, i) => {
        const isMe = first(a.name) === first(memberName);
        return (
          <span key={a.name} className={`relative ${i === 0 ? "" : "-ml-2"}`}>
            <Avatar name={a.name} color={a.color} emoji={a.emoji} size="xs" variant="emoji" />
            {isMe && a.checkedIn && (
              <span className="absolute -bottom-1 -right-1 text-[11px] leading-none">⭐</span>
            )}
          </span>
        );
      })}
      {Array.from({ length: emptySlots }).map((_, i) => (
        <span
          key={`slot-${i}`}
          className="-ml-2 w-7 h-7 rounded-full grid place-items-center text-xs font-bold text-text-muted border border-dashed border-white/25"
        >
          +
        </span>
      ))}
    </div>
  );
}

function statusPill(label: string) {
  return {
    background: `color-mix(in srgb, ${AMBER} 18%, transparent)`,
    color: AMBER,
    border: `1px solid color-mix(in srgb, ${AMBER} 35%, transparent)`,
  } as const;
}

function CrewRow({ task, roster, memberName, onAct }: { task: any; roster: BoardRosterMember[]; memberName: string; onAct: (t: any) => void }) {
  const state = kidBoardState(task, memberName);
  const points = task.points || 0;
  const actionable = state === "joinable" || state === "joined";
  const waiting = state === "checked-in" ? crewWaitingNames(task, memberName) : [];
  const amberRow = state === "checked-in" || state === "all-done";

  const rowStyle = {
    background: `linear-gradient(135deg, color-mix(in srgb, ${amberRow ? AMBER : MINT} ${amberRow ? 12 : 14}%, transparent), color-mix(in srgb, ${amberRow ? AMBER : MINT} ${amberRow ? 4 : 5}%, transparent))`,
    border: `1px solid color-mix(in srgb, ${amberRow ? AMBER : MINT} 30%, transparent)`,
  };

  const body = (
    <>
      <div className="flex items-center gap-3">
        <EmojiTile emoji={task.emoji} tone={amberRow ? AMBER : MINT} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text-primary leading-tight">{task.title}</p>
          <p className="text-[11px] font-semibold text-text-secondary mt-0.5">
            🤝 {crewProgressLabel(task)} · <span style={{ color: MINT }}>+{points} pts each</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <AvatarCluster task={task} roster={roster} memberName={memberName} />
        <div className="flex-1" />
        {actionable && (
          <span className="rounded-xl px-4 py-2 text-xs font-black" style={{ background: MINT, color: "#08240f" }}>
            {state === "joinable" ? "Join crew" : "✓ Done my part"}
          </span>
        )}
        {state === "checked-in" && <span className="rounded-xl px-3 py-2 text-[11px] font-bold" style={statusPill("")}>✓ Done — waiting</span>}
        {state === "all-done" && <span className="rounded-xl px-3 py-2 text-[11px] font-bold" style={statusPill("")}>🎉 All done — waiting for a grown-up</span>}
      </div>
      {waiting.length > 0 && (
        <p className="text-[11px] text-text-muted mt-1.5">waiting on {waiting.join(" & ")} 👀</p>
      )}
    </>
  );

  if (actionable) {
    const ariaLabel = state === "joinable" ? `Join crew: ${task.title}` : `Done my part: ${task.title}`;
    return (
      <button type="button" onClick={() => onAct(task)} aria-label={ariaLabel} className="quest-card tap w-full text-left p-3 block" style={rowStyle}>
        {body}
      </button>
    );
  }
  return (
    <div className="quest-card w-full text-left p-3" style={rowStyle}>
      {body}
    </div>
  );
}

function OpenRow({ task, onAct }: { task: any; onAct: (t: any) => void }) {
  const points = task.points || 0;
  return (
    <button
      type="button"
      onClick={() => onAct(task)}
      aria-label={`Grab it: ${task.title}`}
      className="quest-card tap w-full text-left flex items-center gap-3 p-3"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${CYAN} 12%, transparent), color-mix(in srgb, ${CYAN} 4%, transparent))`,
        border: `1px solid color-mix(in srgb, ${CYAN} 24%, transparent)`,
      }}
    >
      <EmojiTile emoji={task.emoji} tone={CYAN} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-text-primary leading-tight">{task.title}</p>
        <p className="text-[11px] font-semibold text-text-secondary mt-0.5">+{points} pts · fastest fingers!</p>
      </div>
      <span className="rounded-xl px-4 py-2 text-xs font-black shrink-0" style={{ background: CYAN, color: "#06282e" }}>
        Grab it
      </span>
    </button>
  );
}
