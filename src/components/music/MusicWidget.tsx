"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import WidgetCard from "@/components/patterns/WidgetCard";
import IconButton from "@/components/ui/IconButton";
import { useMediaPlayer, type MediaPlayerControls } from "@/hooks/useMediaPlayer";
import { formatDuration } from "@/lib/media/queue";

/**
 * MusicWidget — the Home-page half of the player.
 *
 * Deliberately a *preview*, not a second control surface: it shows what is
 * playing with the three transport controls, and every "more" affordance
 * (search, queue, full player) routes to `/player`. That split is why this file
 * has no search box — one place owns search, so the family never has to guess
 * which of two boxes is live.
 *
 * The stream itself is played by the hook's `<audio>` element, which is
 * rendered here (hidden) rather than in the page: exactly one element per tab
 * must exist, and Home is where the widget lives.
 */

/**
 * Purple keeps the card visually distinct from the Spotify widget's green, and
 * is passed as a CSS var rather than a hex literal: the token already has a
 * light-theme value (`--color-accent-violet`), so a raw hex would ignore the
 * theme and would spend one of the repo's raw-literal budget tokens.
 */
const TONE = "var(--color-accent-violet)";

export default function MusicWidget() {
  const router = useRouter();
  const { audioRef, ...player } = useMediaPlayer();
  const [expanded, setExpanded] = useState(false);

  const { track, isPlaying, progress } = player;

  return (
    <WidgetCard
      tone={TONE}
      icon={
        <span className="grid h-full w-full place-items-center text-white/90">
          <Music2 size={44} aria-hidden="true" />
        </span>
      }
      className="h-full"
    >
      {/* The one and only media element for this tab. */}
      <audio ref={audioRef} preload="none" />

      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Artwork src={track?.artworkUrl ?? null} playing={isPlaying} />

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-text-primary">
              {track ? track.title : "Nothing playing"}
            </h3>
            <p className="truncate text-xs text-text-secondary">
              {track ? track.artist : "Search YouTube Music from the player"}
            </p>
          </div>

          <IconButton
            size="sm"
            variant="ghost"
            aria-label={expanded ? "Hide music player" : "Show music player"}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </IconButton>
        </div>

        {player.error && (
          <p role="status" className="text-xs text-text-secondary">
            {player.error}
          </p>
        )}

        {expanded ? (
          <div className="flex flex-col gap-3">
            <Progress
              progress={progress}
              elapsed={player.state.positionSeconds}
              duration={track?.durationSeconds ?? null}
            />

            <TransportControls player={player} />

            <SoftLink onClick={() => router.push("/player")}>Open the full player →</SoftLink>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <TransportControls player={player} />
          </div>
        )}
      </div>
    </WidgetCard>
  );
}

/**
 * Cover art, or a tinted placeholder. The placeholder keeps the card's height
 * stable before anything has played — a layout that jumps on first play is
 * worse on a wall dashboard than a slightly boring square.
 */
function Artwork({ src, playing }: { src: string | null; playing: boolean }) {
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl">
      {src ? (
         
        // are short-lived and must not go through next/image optimization.
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[var(--color-surface-0)]/40 text-xl">
          <span aria-hidden="true">🎵</span>
        </div>
      )}
      {playing && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-accent-selected)]"
        />
      )}
    </div>
  );
}

function Progress({
  progress,
  elapsed,
  duration,
}: {
  progress: number;
  elapsed: number;
  duration: number | null;
}) {
  return (
    <div>
      {/* Presentational only — the transport buttons and the /player scrubber
          carry the accessible controls. */}
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[var(--color-accent-selected)]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs tabular-nums text-text-muted">
        <span>{formatDuration(elapsed)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}

function TransportControls({
  player,
}: {
  /** The ref-free slice — the widget itself owns the `<audio>` element. */
  player: Omit<MediaPlayerControls, "audioRef">;
}) {
  const { state } = player;
  const hasTrack = Boolean(player.track);

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Previous track"
        disabled={!hasTrack}
        onClick={player.previous}
      >
        <SkipBack aria-hidden="true" />
      </IconButton>

      <IconButton
        size="md"
        variant="accent"
        aria-label={player.isPlaying ? "Pause" : "Play"}
        disabled={!hasTrack}
        onClick={player.togglePlay}
      >
        {player.isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </IconButton>

      <IconButton
        size="sm"
        variant="ghost"
        aria-label="Next track"
        disabled={!hasTrack}
        onClick={player.next}
      >
        <SkipForward aria-hidden="true" />
      </IconButton>

      <span className="ml-auto text-xs tabular-nums text-text-muted">
        {state.index >= 0 && state.queue.length > 1
          ? `${state.index + 1} / ${state.queue.length}`
          : ""}
      </span>
    </div>
  );
}

/** A link styled as the warm-glass inline action. */
function SoftLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start text-xs font-semibold text-[var(--color-accent-selected)] hit-44"
    >
      {children}
    </button>
  );
}
