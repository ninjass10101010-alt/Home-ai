 
"use client";

import { useState } from "react";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import Surface from "@/components/ui/Surface";
import EmptyState from "@/components/ui/EmptyState";
import IconButton from "@/components/ui/IconButton";
import {
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useMediaPlayer, type MediaPlayerControls, type RepeatMode } from "@/hooks/useMediaPlayer";
import { useMediaSearch } from "@/hooks/useMediaSearch";
import { formatDuration } from "@/lib/media/queue";

/**
 * /player — the full-screen half of the media player.
 *
 * This page owns search, the queue and the scrubber; the Home widget owns
 * nothing but the transport buttons and a link back here. That split is the
 * whole point of having two surfaces: the family can glance at Home and tap
 * through to here when they actually want to choose something.
 *
 * Reached from the Home music widget, so it is listed in `EXEMPT_ROUTES`
 * rather than the dock manifest — the dock is already exactly seven caps and
 * adding an eighth would break that contract.
 */

const REPEAT_OPTIONS: { id: RepeatMode; label: string; icon: typeof Repeat }[] = [
  { id: "off", label: "Repeat off", icon: Repeat },
  { id: "all", label: "Repeat queue", icon: Repeat },
  { id: "one", label: "Repeat track", icon: Repeat1 },
];

export default function PlayerPage() {
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const { audioRef, ...player } = useMediaPlayer({ repeat });
  const searchState = useMediaSearch();

  const { track, state, isPlaying } = player;
  const activeRepeat = REPEAT_OPTIONS.find((option) => option.id === repeat) ?? REPEAT_OPTIONS[0];
  const RepeatIcon = activeRepeat.icon;

  return (
    <PageShell>
      {/* The one media element for this tab. */}
      <audio ref={audioRef} preload="none" />

      <PageHeader
        title="Music"
        subtitle="Search YouTube Music and play without ads or video"
        icon={<ListMusic size={26} aria-hidden="true" />}
        backHref="/"
        backLabel="Home"
        action={
          <IconButton
            aria-label={`${activeRepeat.label} — tap to change`}
            onClick={() => {
              const index = REPEAT_OPTIONS.findIndex((option) => option.id === repeat);
              setRepeat(REPEAT_OPTIONS[(index + 1) % REPEAT_OPTIONS.length].id);
            }}
          >
            <RepeatIcon aria-hidden="true" />
          </IconButton>
        }
      />

      <div className="space-y-4 px-4 pb-10">
        <SearchField
          value={searchState.query}
          loading={searchState.loading}
          onChange={searchState.search}
        />

        {searchState.error && (
          <p role="status" className="text-sm text-text-secondary">
            {searchState.error}
          </p>
        )}

        <NowPlaying player={player} />

        {searchState.tracks.length > 0 && (
          <Surface variant="glass-subtle" radius="xl" padding="md">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-text-muted">
              Results
            </h2>
            <ul className="space-y-1">
              {searchState.tracks.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => player.playTracks([result])}
                    className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/5 hit-44"
                  >
                    <Artwork url={result.artworkUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text-primary">
                        {result.title}
                      </span>
                      <span className="block truncate text-xs text-text-secondary">
                        {result.artist}
                      </span>
                    </span>
                    <span className="text-xs tabular-nums text-text-muted">
                      {formatDuration(result.durationSeconds)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Surface>
        )}

        {state.queue.length === 0 && searchState.tracks.length === 0 && (
          <EmptyState
            flat
            icon={<ListMusic size={34} aria-hidden="true" />}
            title="Nothing queued yet"
            description="Search for a song above and it will start playing without ads or video."
          />
        )}

        {state.queue.length > 0 && (
          <Surface variant="glass-subtle" radius="xl" padding="md">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-text-muted">
              Queue ({state.queue.length})
            </h2>
            <ul className="space-y-1">
              {state.queue.map((queued, index) => (
                <li key={`${queued.id}-${index}`}>
                  <div
                    className={`flex items-center gap-2 rounded-xl p-2 ${
                      index === state.index ? "bg-[var(--color-accent-selected)]/10" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => player.skipTo(index)}
                      aria-label={`Play ${queued.title} by ${queued.artist}`}
                      aria-current={index === state.index || undefined}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left hit-44"
                    >
                      <span
                        aria-hidden="true"
                        className="w-4 shrink-0 text-center text-xs tabular-nums text-text-muted"
                      >
                        {index === state.index && isPlaying ? "▸" : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text-primary">
                          {queued.title}
                        </span>
                        <span className="block truncate text-xs text-text-secondary">
                          {queued.artist}
                        </span>
                      </span>
                      <span className="text-xs tabular-nums text-text-muted">
                        {formatDuration(queued.durationSeconds)}
                      </span>
                    </button>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${queued.title} from the queue`}
                      onClick={() => player.removeTrack(queued.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          </Surface>
        )}
      </div>
    </PageShell>
  );
}


/**
 * Search box. Controlled, and deliberately not a form: the hook debounces and
 * talks to the API itself, so a submit would only duplicate that request.
 */
function SearchField({
  value,
  loading,
  onChange,
}: {
  value: string;
  loading: boolean;
  onChange: (query: string) => void;
}) {
  return (
    <div className="relative">
      <Search
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search YouTube Music…"
        aria-label="Search YouTube Music"
        className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/40 py-3 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {loading && (
        <span
          aria-hidden="true"
          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-t-transparent border-[var(--color-accent-selected)]"
        />
      )}
    </div>
  );
}

/** Cover art with a stable-size fallback. */
function Artwork({ url }: { url: string | null }) {
  return url ? (
     
    // short-lived and must not go through next/image optimization.
    <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/5"
    >
      🎵
    </span>
  );
}

function NowPlaying({
  player,
}: {
  /** The ref-free slice — the `<audio>` element belongs to the page, not here. */
  player: Omit<MediaPlayerControls, "audioRef">;
}) {
  const { state, track, isPlaying, progress } = player;
  const duration = track?.durationSeconds ?? null;

  return (
    <Surface variant="glass-subtle" radius="xl" padding="md">
      <div className="flex items-center gap-4">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl">
          <Artwork url={track?.artworkUrl ?? null} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold text-text-primary">
            {track?.title ?? "Nothing playing"}
          </h2>
          <p className="truncate text-sm text-text-secondary">
            {track?.artist ?? "Pick something from the results below"}
          </p>
        </div>
      </div>

      {/* A real range input, not a styled div: the scrubber is the one control
          on this page a family member will actually drag. */}
      <div className="mt-4">
        <input
          type="range"
          min={0}
          max={duration && duration > 0 ? duration : 0}
          step={1}
          value={Math.min(state.positionSeconds, duration ?? state.positionSeconds)}
          onChange={(event) => player.seekTo(Number(event.target.value))}
          disabled={!duration}
          aria-label="Seek within the current track"
          aria-valuetext={`${formatDuration(state.positionSeconds)} of ${formatDuration(duration)}`}
          className="w-full accent-[var(--color-accent-selected)]"
        />
        <div className="mt-1 flex justify-between text-xs tabular-nums text-text-muted">
          <span>{formatDuration(state.positionSeconds)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-3">
        <IconButton
          aria-label="Previous track"
          disabled={!track}
          onClick={player.previous}
        >
          <SkipBack aria-hidden="true" />
        </IconButton>
        <IconButton
          size="lg"
          variant="accent"
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={!track}
          onClick={player.togglePlay}
        >
          {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </IconButton>
        <IconButton
          aria-label="Next track"
          disabled={!track}
          onClick={player.next}
        >
          <SkipForward aria-hidden="true" />
        </IconButton>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={state.muted ? "Unmute" : "Mute"}
          onClick={player.toggleMute}
        >
          {state.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </IconButton>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(state.volume * 100)}
          onChange={(event) => player.changeVolume(Number(event.target.value) / 100)}
          aria-label="Volume"
          className="w-full accent-[var(--color-accent-selected)]"
        />
      </div>

      {/* `progress` is the element's own ratio; shown as text so the bar's
          filled width and the numeric readout can never disagree. */}
      <p className="sr-only" aria-live="polite">
        {track
          ? `${Math.round(progress * 100)}% through ${track.title}`
          : "Nothing playing"}
      </p>

      {player.error && (
        <p role="status" className="mt-3 text-sm text-text-secondary">
          {player.error}
        </p>
      )}
    </Surface>
  );
}
