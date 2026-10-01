/**
 * Queue state for the media player — the small pure state machine shared by
 * the Home widget and the full `/player` page.
 *
 * Kept framework-free and separate from both surfaces on purpose: it is the
 * one place that decides what "next" means, and both surfaces render the same
 * decisions so the widget can never disagree with the full page.
 *
 * Track *identity* is what matters, not object identity — the widget and the
 * page each hold their own `MediaTrack` copies of the same track, and they must
 * line up. Matching is therefore by `id` (plus `source`).
 */

import type { MediaTrack } from "./youtube";

export type PlaybackStatus = "idle" | "playing" | "paused";

export interface PlaybackState {
  /** The queue, in play order. */
  queue: MediaTrack[];
  /** Index into `queue` of the loaded track, or -1 when nothing is loaded. */
  index: number;
  status: PlaybackStatus;
  /** Seconds elapsed in the current track. */
  positionSeconds: number;
  /** 0–1. */
  volume: number;
  muted: boolean;
}

export const INITIAL_PLAYBACK_STATE: PlaybackState = {
  queue: [],
  index: -1,
  status: "idle",
  positionSeconds: 0,
  volume: 0.8,
  muted: false,
};

/** The loaded track, or null when the queue is empty. */
export function currentTrack(state: PlaybackState): MediaTrack | null {
  if (state.index < 0 || state.index >= state.queue.length) return null;
  return state.queue[state.index] ?? null;
}

/**
 * Next index to play, honouring repeat-one. Returns -1 at the end of the queue
 * when repeat is off — the caller turns that into "stopped", not "wrap", so a
 * finished queue never silently restarts itself.
 */
export function nextIndex(
  state: PlaybackState,
  repeat: "off" | "all" | "one",
  direction: 1 | -1 = 1,
): number {
  const { queue, index } = state;
  if (!queue.length) return -1;
  if (repeat === "one" && direction === 1 && index >= 0) return index;

  const candidate = index + direction;
  if (candidate < 0) return repeat === "all" ? queue.length - 1 : -1;
  if (candidate >= queue.length) return repeat === "all" ? 0 : -1;
  return candidate;
}

export interface QueueAction {
  state: PlaybackState;
  /** True when the track changed, so the caller must load a new stream URL. */
  trackChanged: boolean;
}

/** Replace the queue entirely and play from the start. */
export function replaceQueue(state: PlaybackState, tracks: MediaTrack[]): QueueAction {
  if (!tracks.length) {
    return { state: { ...INITIAL_PLAYBACK_STATE }, trackChanged: true };
  }
  return {
    state: { ...state, queue: tracks, index: 0, status: "playing", positionSeconds: 0 },
    trackChanged: true,
  };
}

/** Jump to an absolute queue position. Out-of-range indexes are ignored. */
export function jumpTo(state: PlaybackState, index: number): QueueAction {
  if (index < 0 || index >= state.queue.length) return { state, trackChanged: false };
  return {
    state: { ...state, index, status: "playing", positionSeconds: 0 },
    trackChanged: true,
  };
}


/** Append tracks and start playing the first one appended. */
export function playTracks(state: PlaybackState, tracks: MediaTrack[]): QueueAction {
  if (!tracks.length) return { state, trackChanged: false };
  return {
    state: {
      ...state,
      queue: [...state.queue, ...tracks],
      index: 0,
      status: "playing",
      positionSeconds: 0,
    },
    trackChanged: true,
  };
}

/**
 * Step by `direction`, or stop when the queue runs out (repeat off).
 *
 * `trackChanged` is computed by comparing indexes, not by assuming: with
 * repeat-one the index genuinely does not move, and a caller that reloads the
 * stream on that signal would restart the track out of sync with the audio.
 * Stopping clears the index entirely so `currentTrack` returns null and the UI
 * falls back to "nothing playing" instead of showing a stale paused track.
 */
export function step(
  state: PlaybackState,
  repeat: "off" | "all" | "one",
  direction: 1 | -1 = 1,
): QueueAction {
  const target = nextIndex(state, repeat, direction);
  if (target < 0) {
    return {
      state: { ...state, index: -1, status: "idle", positionSeconds: 0 },
      trackChanged: true,
    };
  }
  const changed = target !== state.index;
  return {
    state: changed
      ? { ...state, index: target, status: "playing", positionSeconds: 0 }
      : { ...state, positionSeconds: 0 },
    trackChanged: changed,
  };
}

export function togglePlay(state: PlaybackState): PlaybackState {
  if (!currentTrack(state)) return state;
  return { ...state, status: state.status === "playing" ? "paused" : "playing" };
}

/** Clamp a seek so a scrub can never move outside the loaded track. */
export function seek(state: PlaybackState, seconds: number): PlaybackState {
  const duration = currentTrack(state)?.durationSeconds;
  const max = typeof duration === "number" && duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
  return { ...state, positionSeconds: Math.min(Math.max(0, seconds), max) };
}

export function setVolume(state: PlaybackState, volume: number): PlaybackState {
  return { ...state, volume: Math.min(1, Math.max(0, volume)), muted: false };
}

export function toggleMute(state: PlaybackState): PlaybackState {
  return { ...state, muted: !state.muted };
}

/** Advance the clock; rolls into the next track when one is queued. */
export function tick(
  state: PlaybackState,
  seconds: number,
  repeat: "off" | "all" | "one",
): QueueAction {
  if (state.status !== "playing") return { state, trackChanged: false };
  const duration = currentTrack(state)?.durationSeconds;
  const next = state.positionSeconds + seconds;

  if (typeof duration === "number" && duration > 0 && next >= duration) {
    if (repeat === "one") {
      return { state: { ...state, positionSeconds: 0 }, trackChanged: false };
    }
    return step(state, repeat, 1);
  }
  return { state: { ...state, positionSeconds: next }, trackChanged: false };
}

/** Remove one queue entry, keeping the current track loaded when possible. */
export function removeFromQueue(state: PlaybackState, trackId: string): QueueAction {
  const target = state.queue.findIndex((track) => track.id === trackId);
  if (target < 0) return { state, trackChanged: false };

  const queue = state.queue.filter((track) => track.id !== trackId);
  if (!queue.length) {
    return {
      state: { ...state, queue: [], index: -1, status: "idle", positionSeconds: 0 },
      trackChanged: true,
    };
  }

  let index = state.index;
  if (target < state.index) index = state.index - 1;
  else if (target === state.index) index = Math.min(state.index, queue.length - 1);

  return { state: { ...state, queue, index, positionSeconds: 0 }, trackChanged: true };
}

/** Seconds → `m:ss` (or `h:mm:ss` past an hour). */
export function formatDuration(seconds: number | null): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Fraction played, for a progress bar. 0 when the duration is unknown. */
export function progressFraction(state: PlaybackState): number {
  const duration = currentTrack(state)?.durationSeconds;
  if (typeof duration !== "number" || duration <= 0) return 0;
  return Math.min(1, Math.max(0, state.positionSeconds / duration));
}

/**
 * The single `<audio>` element URL for a track. Kept as a function so the proxy
 * contract (and any future Plex/Jellyfin source) lives in one place.
 */
export function streamUrlFor(trackId: string): string {
  return `/api/media/stream?id=${encodeURIComponent(trackId)}`;
}
