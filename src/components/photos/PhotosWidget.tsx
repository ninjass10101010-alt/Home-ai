"use client";

/* eslint-disable react-hooks/set-state-in-effect -- this component's state IS
   the mount fetch and the rotation timer: the initial load, the decode-gated
   crossfade commit, and the reduced-motion listener all land state from an
   async boundary. Same posture as WeatherWidget/MuseApiCard. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/components/ui/EmptyState";
import { usePrefersReducedMotion } from "@/hooks/useReducedMotionPreference";
import { usePhotoSettings } from "@/hooks/usePhotoSettings";
import { commitDelayMs, type PhotoTransition } from "@/lib/photos/settings";
import { isOnThisDay, type WallPhoto } from "@/db/features/photos";

/**
 * Wall photo stream — a full-bleed family photo that changes over time.
 *
 * Three constraints shaped this component:
 *
 *  - BURN-IN vs MOTION. A panel that holds one image for hours develops image
 *    retention, so the photo must change; but the wall's motion budget forbids
 *    infinite CSS animation. The resolution is *discrete* rotation: a JS timer
 *    fires every ~75s and performs a single crossfade, which is an event, not an
 *    animation loop. Nothing here runs on a rAF loop or animates forever.
 *  - NEVER SHOW IT WORKING. The next photo is decoded before it is composited,
 *    so the wall never flashes a half-loaded image or a broken-image icon. If
 *    the decode fails, the current photo simply stays.
 *  - IT CANNOT OVERFLOW. Unlike text widgets, whose content pushed past the
 *    measured card box, an image is cropped by its container. This tile is the
 *    one widget that fits the 3×4 wall grid by construction.
 */

/** The original fixed hold (75 s). Since §3.2 the live value comes from the
 *  shared settings (`PHOTO_SETTINGS_DEFAULTS.rotateSeconds` === this), so the
 *  constant stays as the documented default the prop was born overriding. */
const ROTATE_MS = 75_000;
/** Photos requested per pass. The queue is refetched once it has been walked. */
const QUEUE_SIZE = 24;
/** How many recently-shown ids to ask the server to hold back. */
const RECENT_MEMO = 8;
/** A hung feed must not pin the tile in "loading" forever — see `load`. */
const FEED_TIMEOUT_MS = 15_000;
/** Recovery cadence while the feed is stuck in a terminal state. */
const RETRY_BACKOFF_MS = 30_000;
/** Cap on consecutive failed retries — never hammer a server that is down. */
const RETRY_MAX_ATTEMPTS = 5;
/** Rotation floor: below this the wall reads as a strobe, not a slideshow. */
const ROTATE_MIN_MS = 1000;

interface PhotosWidgetProps {
  className?: string;
  /** Override the rotation interval (tests, future per-room tuning). */
  rotateMs?: number;
  /** Skip the fetch and render `photos` directly (tests). */
  photos?: WallPhoto[];
}

type FeedState = "loading" | "ready" | "empty" | "error";

function formatPhotoDate(iso: string, withDay = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(
    undefined,
    withDay
      ? { month: "long", day: "numeric", year: "numeric" }
      : { month: "long", year: "numeric" },
  );
}

function captionFor(photo: WallPhoto): string {
  const onThisDay = isOnThisDay(photo.takenAt);
  // "On this day" without a family caption dates the moment precisely: the
  // month/year used elsewhere would hide WHICH day this was years ago.
  const base = photo.caption?.trim() || formatPhotoDate(photo.takenAt, onThisDay);
  return onThisDay ? `On this day · ${base}` : base;
}

function altFor(photo: WallPhoto): string {
  // Same rule as the caption: when the date itself is the text (no caption),
  // an "on this day" photo carries the day-of-month so the announcement says
  // which day it was, not just the month.
  const date = formatPhotoDate(photo.takenAt, isOnThisDay(photo.takenAt));
  if (photo.caption?.trim()) return photo.caption.trim();
  return date ? `Family photo from ${date}` : "Family photo";
}

export default function PhotosWidget({
  className = "",
  rotateMs: rotateMsProp,
  photos: photosProp,
}: PhotosWidgetProps) {
  const router = useRouter();
  /**
   * Shared wall settings (spec §3). Starts at `PHOTO_SETTINGS_DEFAULTS`, so
   * the first photo never waits on config — `loading` is deliberately not
   * read for rendering, only for correctness of the values themselves.
   */
  const { settings, refresh } = usePhotoSettings();
  const [photos, setPhotos] = useState<WallPhoto[]>(photosProp ?? []);
  const [state, setState] = useState<FeedState>(photosProp ? "ready" : "loading");
  const [shown, setShown] = useState<WallPhoto | null>(photosProp?.[0] ?? null);
  const [incoming, setIncoming] = useState<WallPhoto | null>(null);
  /** Flips the incoming layer to full opacity one frame after it mounts. */
  const [armed, setArmed] = useState(false);
  /**
   * Reduced motion comes from the OS *or* from the family's own Settings →
   * Appearance toggle, so it is read through the app's one preference hook —
   * a direct `matchMedia` here is what left the in-app toggle inert.
   */
  const reduceMotion = usePrefersReducedMotion();
  /**
   * WCAG 2.2.2 (Pause, Stop, Hide — Level A). The rotation is moving content
   * that starts by itself and never stops, so the family gets a real control to
   * stop it.
   *
   * `null` means "the family has not said", and the carousel then follows the
   * reduced-motion preference — which is what makes it START paused under
   * reduced motion, not merely swap faster. Once they press the control their
   * choice is authoritative, so play really does resume: a toggle whose play
   * state could not be reached would be worse than no control at all. (Honest
   * nuance: a reduce-motion preference switched on *after* an explicit play is
   * not re-applied until the family presses again — the deliberate press is
   * treated as the newer signal.)
   */
  const [pausedByChoice, setPausedByChoice] = useState<boolean | null>(null);
  const paused = pausedByChoice ?? reduceMotion;
  /**
   * Spec §3.2: the `rotateMs` prop stays a test/per-room override and keeps
   * its precedence; otherwise the shared setting drives the cadence. The
   * interval effect keys on this NUMBER, never on the settings object, so a
   * refetch that returns identical values does not reset the countdown
   * mid-photo (§3.1).
   */
  const rotateMs = rotateMsProp ?? settings.rotateSeconds * 1000;
  /**
   * Spec §3.5: the app's reduced-motion preference (OS **or** the in-app
   * Settings toggle, via the one authority hook) forces a hard cut for every
   * selection — the family's chosen transition still applies everywhere the
   * preference is off.
   */
  const effectiveTransition: PhotoTransition = reduceMotion ? "cut" : settings.transition;
  /**
   * Dissolve's veil lifecycle (spec §3.3): "cover" fades black in over the
   * outgoing photo, the swap happens under a fully opaque veil, "reveal"
   * fades it back out and unmounts it. Kept out of the commit effect's deps —
   * it is an OUTPUT of that effect, never an input, so an identical settings
   * refetch cannot re-run a transition.
   */
  const [veilState, setVeilState] = useState<"idle" | "cover" | "reveal">("idle");

  const cursorRef = useRef(0);
  /** The id currently composited. Rotation must never re-pick it. */
  const shownIdRef = useRef<string | null>(photosProp?.[0]?.id ?? null);
  const recentRef = useRef<string[]>([]);
  const mountedRef = useRef(true);
  const photosRef = useRef<WallPhoto[]>(photosProp ?? []);
  /** The in-flight feed load. A new load supersedes it; unmount cancels it. */
  const loadAbortRef = useRef<AbortController | null>(null);
  /** Failed recovery attempts since the last success — the backoff budget. */
  const retryBudgetRef = useRef(0);
  /** One shown-layer image error earns one rescue rotation per queue, not a loop. */
  const shownErrorRetriedRef = useRef(false);
  /** Dissolve's post-swap fade-out timer — lives in a ref so the commit
   *  effect's own cleanup (which runs when the swap clears `incoming`) does
   *  not cancel the reveal it just started. Cleared on unmount and whenever a
   *  new transition supersedes a reveal still in flight. */
  const veilRevealTimerRef = useRef<number | null>(null);
  // Updated from an effect, not during render: the rotation timer reads this
  // queue, and writing a ref in the render body is exactly what the
  // react-hooks/refs rule exists to prevent.
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Leaving the wall (layout swap, navigation) must not leave a feed
      // request running against a server nobody is watching anymore.
      loadAbortRef.current?.abort();
      if (veilRevealTimerRef.current !== null) {
        window.clearTimeout(veilRevealTimerRef.current);
        veilRevealTimerRef.current = null;
      }
    };
  }, []);

  const load = useCallback(async (recent: string[], keepCurrent: boolean) => {
    // §3.7: `order` is part of the query AND of this callback's identity —
    // a new order is a new sequence, so the mount effect below refires and
    // reseeds the queue the moment the family changes it.
    const query = new URLSearchParams({ limit: String(QUEUE_SIZE), order: settings.order });
    if (recent.length > 0) query.set("recent", recent.join(","));
    // Supersede whatever this widget already has in flight — a walk-end refresh
    // landing on top of a recovery retry would otherwise race itself.
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(FEED_TIMEOUT_MS),
    ]);
    try {
      const res = await fetch(`/api/photos?${query.toString()}`, {
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error(`photos feed returned ${res.status}`);
      const data = await res.json();
      const list: WallPhoto[] = Array.isArray(data?.photos) ? data.photos : [];
      if (!mountedRef.current) return;
      retryBudgetRef.current = 0;
      shownErrorRetriedRef.current = false;
      setPhotos(list);
      if (list.length === 0) {
        setShown(null);
        setState("empty");
        return;
      }
      setState("ready");
      if (!keepCurrent) {
        // list[0] goes up immediately, so the queue cursor starts at the next
        // one — pointing the cursor back at index 0 made the first rotation
        // "advance" to the picture already on screen.
        cursorRef.current = 1;
        shownIdRef.current = list[0].id;
        setShown(list[0]);
      } else {
        // The refresh landed: rewind for the new queue. Left past the end, the
        // walk-end condition below stays true forever and fires one fetch on
        // EVERY rotation — the refetch storm.
        cursorRef.current = 0;
        // Queue-walk refresh (§3.1): the fresh ordering is in, so pick up any
        // settings change made while the wall was walking. `refresh` only ever
        // writes settings state — its deps (order, refresh identity) cannot
        // re-enter `advance`, so this cannot loop.
        void refresh();
      }
    } catch {
      if (!mountedRef.current) return;
      if (signal.aborted) {
        // A superseded/cancelled/timed-out load must not flap a wall that is
        // already showing photos into an error banner. An initial load that
        // died still has to say so — it has nothing else to show.
        setState((current) => (current === "loading" ? "error" : current));
        return;
      }
      // A missing collection, a PocketBase restart, a network blip: say so.
      // Never substitute a placeholder image — this is the family's wall.
      setState((current) => (current === "ready" ? "ready" : "error"));
    }
  }, [settings.order, refresh]);

  /**
   * Manual recovery (the error state's "Try again", a tab coming back to
   * focus): re-arm the backoff budget, then refetch from scratch.
   */
  const retryNow = useCallback(() => {
    retryBudgetRef.current = 0;
    void load([], false);
  }, [load]);

  // (2a/2b) Terminal states recover on their own: a bounded backoff while the
  // feed is in "error"/"empty", plus an immediate refetch when a hidden panel
  // comes back to view. "ready" deliberately gets neither — rotation owns it.
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (photosProp) return;
    if (state !== "error" && state !== "empty") return;
    if (retryBudgetRef.current >= RETRY_MAX_ATTEMPTS) return;
    const id = window.setTimeout(() => {
      retryBudgetRef.current += 1;
      setRetryTick((tick) => tick + 1);
      void load([], false);
    }, RETRY_BACKOFF_MS);
    return () => window.clearTimeout(id);
  }, [state, load, photosProp, retryTick]);

  useEffect(() => {
    if (photosProp) return;
    if (state !== "error" && state !== "empty") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      retryNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state, photosProp, retryNow]);

  useEffect(() => {
    if (photosProp) return;
    void load([], false);
  }, [load, photosProp]);

  /**
   * Composite the next photo only once the browser has it fully decoded, then
   * commit it after the crossfade has had time to finish.
   */
  const advance = useCallback(async () => {
    const queue = photosRef.current;
    if (queue.length < 2) return;

    const attempted = new Set<string>();
    let next: WallPhoto | null = null;
    // One undecodable photo must not burn a whole rotation: walk candidates
    // within THIS tick until one decodes, bounded to a single pass over the
    // queue (break as soon as we circle back to a candidate we tried).
    for (let tries = 0; tries < queue.length && !next; tries++) {
      const candidate = queue[cursorRef.current % queue.length];
      cursorRef.current += 1;
      if (!candidate) break;
      // Never "rotate" onto the picture already on screen: a duplicate layer key
      // and a frame where nothing changed is exactly what the family would see.
      if (candidate.id === shownIdRef.current) continue;
      if (attempted.has(candidate.id)) break;
      attempted.add(candidate.id);
      try {
        const probe = new Image();
        probe.decoding = "async";
        probe.src = candidate.url;
        const decodable = probe as HTMLImageElement & { decode?: () => Promise<void> };
        if (typeof decodable.decode === "function") {
          await decodable.decode();
        } else if (!probe.complete) {
          await new Promise<void>((resolve, reject) => {
            probe.onload = () => resolve();
            probe.onerror = () => reject(new Error("decode failed"));
          });
        }
        next = candidate;
      } catch {
        // Keep looking — and deliberately do NOT mark this id as seen: a photo
        // the wall never showed must not be held back from the next refresh.
      }
    }

    if (!next || !mountedRef.current) return;
    // Only a photo that actually decoded enters the recent memo, right before
    // it is composited.
    recentRef.current = [...recentRef.current, next.id].slice(-RECENT_MEMO);
    setArmed(false);
    setIncoming(next);

    // Walked the whole queue: ask for a fresh ordering that holds back what
    // the wall just showed, instead of looping visibly.
    if (cursorRef.current >= queue.length) {
      void load(recentRef.current, true);
    }
    // Refresh cadence (§3.1): no polling timer — a change made on a phone
    // lands on the wall within one rotation, for free. This runs only on a
    // successful advance; the paused/single-photo/decode-fail cases the spec
    // names as caveats are covered by the hook's `visibilitychange` refetch.
    // `refresh` writes settings state only and never reaches back into
    // `advance`, so it cannot make this loop.
    void refresh();
  }, [load, refresh]);

  useEffect(() => {
    // Paused means no timer at all, not a timer that no-ops: under reduced
    // motion the carousel must not autoplay, and a paused family member must get
    // their photo back. Burn-in still happens when they press play.
    if (paused || state !== "ready" || photos.length < 2) return;
    // Floor (9): a sub-second override would turn the wall into a strobe.
    const interval = Math.max(ROTATE_MIN_MS, rotateMs);
    const id = window.setInterval(() => {
      if (document.hidden) return; // nobody is watching a sleeping panel
      void advance();
    }, interval);
    return () => window.clearInterval(id);
  }, [advance, paused, photos.length, rotateMs, state]);

  /**
   * Commit the decoded incoming layer once the chosen transition has run
   * (spec §3.4). Keyed on PRIMITIVES only — `incoming`, `effectiveTransition`,
   * `reduceMotion` — never on the `settings` object or `veilState`, so a
   * settings refetch with identical values re-renders without re-arming or
   * resetting anything mid-photo.
   *
   * The arm `requestAnimationFrame` comes first and the commit clock starts
   * inside it: every variant's delay is counted from the arm, which is what
   * makes dissolve's veil reach full opacity exactly at its swap instant, and
   * gives `cut` its single `is-instant` frame before a 0 ms swap.
   */
  useEffect(() => {
    if (!incoming) return;
    // A new transition supersedes a reveal that is still fading out; the
    // effect never keys on `veilState`, so clearing it lives here.
    if (veilRevealTimerRef.current !== null) {
      window.clearTimeout(veilRevealTimerRef.current);
      veilRevealTimerRef.current = null;
    }
    setVeilState(effectiveTransition === "dissolve" ? "cover" : "idle");
    let commitTimer: number | null = null;
    const commit = () => {
      if (!mountedRef.current) return;
      shownIdRef.current = incoming.id;
      setShown(incoming);
      setIncoming(null);
      setArmed(false);
      if (effectiveTransition === "dissolve") {
        // The swap just happened under a fully opaque veil; keep it mounted
        // while it fades back out, then unmount at zero.
        setVeilState("reveal");
        veilRevealTimerRef.current = window.setTimeout(
          () => {
            veilRevealTimerRef.current = null;
            if (mountedRef.current) setVeilState("idle");
          },
          commitDelayMs("dissolve", reduceMotion),
        );
      }
    };
    const frame = window.requestAnimationFrame(() => {
      setArmed(true);
      commitTimer = window.setTimeout(commit, commitDelayMs(effectiveTransition, reduceMotion));
    });
    return () => {
      // A mid-flight transition change or a superseding advance cancels
      // cleanly: no timer can double-fire (the effect is single-instance and
      // this runs before any re-run), and `setVeilState` in the re-run body
      // guarantees no armed/veil state is left stuck (§3.3).
      window.cancelAnimationFrame(frame);
      if (commitTimer !== null) window.clearTimeout(commitTimer);
    };
  }, [incoming, effectiveTransition, reduceMotion]);

  const slideActive = effectiveTransition === "slide" && incoming !== null;
  const cutActive = effectiveTransition === "cut";
  // Slide needs the tile itself to read black between the two layers —
  // surface-0 is a light grey in light mode and would flash mid-slide. Same
  // black the scrim already paints (constraint 11: no new colours).
  const shell = `wall-photo-tile relative overflow-hidden${slideActive ? " is-sliding" : ""} ${className}`.trim();

  // (8) Never render a broken-image tile. An INCOMING layer that fails is
  // abandoned (the shown photo stands — same posture as a failed decode); a
  // broken SHOWN layer gets one rescue rotation per queue, and if that lands
  // on another broken image the honest state is "unavailable", not a loop.
  const onShownError = () => {
    if (photosRef.current.length > 1 && !shownErrorRetriedRef.current) {
      shownErrorRetriedRef.current = true;
      void advance();
      return;
    }
    setState("error");
  };
  const onIncomingError = () => {
    setArmed(false);
    setIncoming(null);
  };

  if (state === "error") {
    return (
      <div className={shell}>
        <EmptyState
          flat
          icon="📡"
          title="Photos unavailable"
          description="The family photo library can't be reached right now."
          actionLabel="Try again"
          onAction={retryNow}
        />
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div
        className={`${shell} wall-photo-skeleton`}
        role="status"
        aria-busy="true"
        aria-label="Loading photos"
      >
        <span className="sr-only">Loading photos</span>
      </div>
    );
  }

  if (state === "empty" || !shown) {
    return (
      <div className={shell}>
        <EmptyState
          flat
          icon="📸"
          title="No photos yet"
          description="Add a picture from the Photos page and it will appear here."
          actionLabel="Add a photo"
          onAction={() => router.push("/photos")}
        />
      </div>
    );
  }

  const caption = captionFor(shown);
  // §3.6: the caption and its scrim hide together — a scrim with no caption
  // is unexplained darkening across the bottom third of the family's photo.
  const showCaptionLayer = settings.showCaption;

  return (
    <div className={shell}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={shown.id}
        src={shown.url}
        alt={altFor(shown)}
        draggable={false}
        onError={onShownError}
        className={`wall-photo-img${slideActive ? " wall-photo-outgoing" : ""}${slideActive && armed ? " is-armed" : ""}`}
      />
      {incoming && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={incoming.id}
          src={incoming.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={onIncomingError}
          className={`wall-photo-img wall-photo-incoming${armed ? " is-armed" : ""}${cutActive ? " is-instant" : ""}${slideActive ? " is-slide" : ""}`}
        />
      )}
      {showCaptionLayer && <div className="wall-photo-scrim" aria-hidden="true" />}
      {showCaptionLayer && caption && (
        <p className="wall-photo-caption" translate="no">
          {caption}
        </p>
      )}
      {photos.length > 1 && (
        // The placement wrapper is `absolute` and the button itself is `relative`
        // via `.hit-44`, which also guarantees its 44px hit box without changing
        // the 36px visual. Deliberately NOT a `glass-*` surface: those classes
        // define their own `::before`, which would replace the `.hit-44::before`
        // box and silently drop the guarantee.
        <div className="absolute right-5 top-5">
          <button
            type="button"
            onClick={() => setPausedByChoice((was) => !(was ?? reduceMotion))}
            // Static name + pressed state is the standard toggle-button pairing:
            // "Pause photo rotation, pressed" reads as paused without the
            // double-announcement of a label that also changes. `title` mirrors
            // the accessible name — a tooltip that said "Resume" while the
            // button announced "Pause" was two stories for one control.
            aria-label="Pause photo rotation"
            aria-pressed={paused}
            title="Pause photo rotation"
            className="hit-44 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[var(--color-surface-0)]/60 text-white backdrop-blur-md hover:bg-[var(--color-surface-0)]/85 tap-sm"
          >
            {paused ? (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.5-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />
              </svg>
            )}
          </button>
        </div>
      )}
      {veilState !== "idle" && (
        // Dissolve's one-shot veil (spec §3.3): fades in over the outgoing
        // photo (`is-armed` only once `armed` flips, so the 0 → 1 fade actually
        // animates), holds fully opaque across the layer swap, then unmounts
        // after its fade-out. `pointer-events: none` keeps it off the hit path;
        // it sits last so it veils caption and pause glyph with the photo.
        <div
          aria-hidden="true"
          className={`wall-photo-veil${veilState === "cover" && armed ? " is-armed" : ""}`}
        />
      )}
    </div>
  );
}
