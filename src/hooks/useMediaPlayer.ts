"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaTrack } from "@/lib/media/youtube";
import {
  INITIAL_PLAYBACK_STATE,
  currentTrack,
  jumpTo,
  progressFraction,
  removeFromQueue,
  replaceQueue,
  seek,
  setVolume,
  step,
  streamUrlFor,
  toggleMute,
  togglePlay,
  type PlaybackState,
} from "@/lib/media/queue";

/**
 * Playback is owned by this hook and driven by ONE `<audio>` element per tab.
 *
 * Why it is tab-local and not server-side for this slice: a browser media
 * element is the only thing that can decode and emit the stream, so the element
 * has to live in the tab anyway. Moving the clock to the server (SSE/WebSocket
 * fan-out so every open device shares one position) is the next step, and
 * `lib/media/queue.ts` is deliberately framework-free so that swap doesn't
 * touch this file's decision logic.
 *
 * Autoplay policy: browsers refuse `audio.play()` without a user gesture. The
 * first play always follows a click here, so the promise resolves normally; a
 * later programmatic advance is what can be blocked, and `attemptPlay` swallows
 * that rejection and leaves the state as "paused" rather than lying about it.
 */

export type RepeatMode = "off" | "all" | "one";

export interface UseMediaPlayerOptions {
  repeat?: RepeatMode;
}

export interface MediaPlayerControls extends MediaPlayerActions {
  state: PlaybackState;
  /** The loaded track, or null. */
  track: MediaTrack | null;
  isPlaying: boolean;
  /** 0–1. */
  progress: number;
  /** Message from the last failed stream attempt, cleared on the next load. */
  error: string | null;
  /**
   * The `<audio>` element for this tab. Returned outside the memoised controls
   * so a consumer can pass it straight to `ref` without the compiler lint
   * reading that as a ref access during render.
   */
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

/** Everything a surface can *do* — safe to pass down as a plain prop. */
export interface MediaPlayerActions {
  playTracks: (tracks: MediaTrack[]) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  skipTo: (index: number) => void;
  removeTrack: (trackId: string) => void;
  seekTo: (seconds: number) => void;
  changeVolume: (volume: number) => void;
  toggleMute: () => void;
}

export function useMediaPlayer(options: UseMediaPlayerOptions = {}): MediaPlayerControls {
  const repeat = options.repeat ?? "off";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlaybackState>(INITIAL_PLAYBACK_STATE);
  const [error, setError] = useState<string | null>(null);

  const attemptPlay = useCallback((element: HTMLAudioElement) => {
    element.play().catch(() => {
      // Autoplay was refused. Reflect that honestly instead of pretending.
      setState((prev) => (prev.status === "playing" ? { ...prev, status: "paused" } : prev));
    });
  }, []);

  // `state` inside the <audio> event handlers would be a stale closure, so the
  // always-current value lives in a ref that the callbacks read. It is synced in
  // an effect rather than during render so React's ref rules stay happy.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** Point the element at the loaded track; false when nothing is loaded. */
  const loadTrack = useCallback(
    (next: PlaybackState): boolean => {
      const element = audioRef.current;
      const track = currentTrack(next);
      if (!element || !track) return false;

      setError(null);
      element.src = streamUrlFor(track.id);
      element.load();
      element.volume = next.muted ? 0 : next.volume;
      if (next.status === "playing") attemptPlay(element);
      return true;
    },
    [attemptPlay],
  );

  // Drive the element whenever the *loaded track* changes — deliberately not on
  // every state change, because a seek goes through `currentTime` below and must
  // not restart the stream.
  //
  // `apply()` already loads the new track synchronously, so this effect is the
  // *fallback* for the one case that cannot be handled there: the very first
  // track being loaded before the ref was attached. The `lastLoadedId` guard is
  // what stops the two paths from both firing and restarting the same track.
  const loadedTrackId = currentTrack(state)?.id ?? null;
  const lastLoadedId = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedTrackId) return;
    if (lastLoadedId.current === loadedTrackId) return;
    lastLoadedId.current = loadedTrackId;
    loadTrack(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the track only, on purpose
  }, [loadedTrackId]);

  // Volume and mute are properties of the element, so mirror them directly.
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.volume = state.muted ? 0 : state.volume;
    element.muted = state.muted;
  }, [state.volume, state.muted]);

  // The element is the clock: `timeupdate` is the single source of truth for
  // position, which is what makes a scrub land where the user dropped it.
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;

    const onTimeUpdate = () => {
      setState((prev) =>
        Math.abs(prev.positionSeconds - element.currentTime) < 0.5
          ? prev
          : { ...prev, positionSeconds: element.currentTime },
      );
    };
    const onEnded = () => setState((prev) => step(prev, repeat, 1).state);
    const onPlay = () =>
      setState((prev) => (prev.status === "playing" ? prev : { ...prev, status: "playing" }));
    const onPause = () =>
      setState((prev) => (prev.status === "paused" ? prev : { ...prev, status: "paused" }));
    const onError = () => {
      // A dead upstream must not leave a spinning play button: stop and say so.
      setError("This track could not be played right now.");
      setState((prev) => ({ ...prev, status: "paused" }));
    };

    element.addEventListener("timeupdate", onTimeUpdate);
    element.addEventListener("ended", onEnded);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("error", onError);
    return () => {
      element.removeEventListener("timeupdate", onTimeUpdate);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("error", onError);
    };
  }, [repeat]);

  /** Apply an action, reloading the element only when the track actually changed. */
  const apply = useCallback(
    (action: { state: PlaybackState; trackChanged: boolean }) => {
      setState(action.state);
      if (!action.trackChanged) return;
      const track = currentTrack(action.state);
      // Record the load here so the track-change effect does not immediately
      // reload the same track and restart playback from zero.
      if (track) lastLoadedId.current = track.id;
      loadTrack(action.state);
    },
    [loadTrack],
  );

  const playTracks = useCallback(
    (tracks: MediaTrack[]) => apply(replaceQueue(stateRef.current, tracks)),
    [apply],
  );

  const togglePlayControl = useCallback(() => {
    const nextState = togglePlay(stateRef.current);
    setState(nextState);
    const element = audioRef.current;
    if (!element) return;
    if (nextState.status === "playing") attemptPlay(element);
    else element.pause();
  }, [attemptPlay]);

  const next = useCallback(() => apply(step(stateRef.current, repeat, 1)), [apply, repeat]);
  const previous = useCallback(() => apply(step(stateRef.current, repeat, -1)), [apply, repeat]);

  const skipTo = useCallback((index: number) => apply(jumpTo(stateRef.current, index)), [apply]);

  const removeTrack = useCallback(
    (trackId: string) => apply(removeFromQueue(stateRef.current, trackId)),
    [apply],
  );

  const seekTo = useCallback((seconds: number) => {
    const element = audioRef.current;
    setState((prev) => seek(prev, seconds));
    if (element) element.currentTime = Math.max(0, seconds);
  }, []);

  const changeVolume = useCallback((volume: number) => {
    setState((prev) => setVolume(prev, volume));
  }, []);

  const toggleMuteControl = useCallback(() => {
    setState((prev) => toggleMute(prev));
  }, []);

  // `audioRef` is deliberately NOT inside the memo: consumers pass it straight
  // to `<audio ref={…}>`, and returning a ref from a `useMemo` makes the
  // compiler lint treat every read of it as a ref access during render.
  const controls = useMemo(
    () => ({
      state,
      track: currentTrack(state),
      isPlaying: state.status === "playing",
      progress: progressFraction(state),
      error,
      playTracks,
      togglePlay: togglePlayControl,
      next,
      previous,
      skipTo,
      removeTrack,
      seekTo,
      changeVolume,
      toggleMute: toggleMuteControl,
    }),
    [
      state,
      error,
      playTracks,
      togglePlayControl,
      next,
      previous,
      skipTo,
      removeTrack,
      seekTo,
      changeVolume,
      toggleMuteControl,
    ],
  );

  return { audioRef, ...controls };
}

