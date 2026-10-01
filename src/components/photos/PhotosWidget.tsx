"use client";

/* eslint-disable react-hooks/set-state-in-effect -- this component's state IS
   the mount fetch and the rotation timer: the initial load, the decode-gated
   crossfade commit, and the reduced-motion listener all land state from an
   async boundary. Same posture as WeatherWidget/MuseApiCard. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/components/ui/EmptyState";
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

/** Long enough to feel like a slideshow, short enough to fight retention. */
const ROTATE_MS = 75_000;
/** One crossfade per photo change — the entire motion cost of this widget. */
const CROSSFADE_MS = 600;
/** Photos requested per pass. The queue is refetched once it has been walked. */
const QUEUE_SIZE = 24;
/** How many recently-shown ids to ask the server to hold back. */
const RECENT_MEMO = 8;

interface PhotosWidgetProps {
  className?: string;
  /** Override the rotation interval (tests, future per-room tuning). */
  rotateMs?: number;
  /** Skip the fetch and render `photos` directly (tests). */
  photos?: WallPhoto[];
}

type FeedState = "loading" | "ready" | "empty" | "error";

function formatPhotoDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function captionFor(photo: WallPhoto): string {
  const base = photo.caption?.trim() || formatPhotoDate(photo.takenAt);
  return isOnThisDay(photo.takenAt) ? `On this day · ${base}` : base;
}

function altFor(photo: WallPhoto): string {
  const date = formatPhotoDate(photo.takenAt);
  if (photo.caption?.trim()) return photo.caption.trim();
  return date ? `Family photo from ${date}` : "Family photo";
}

export default function PhotosWidget({
  className = "",
  rotateMs = ROTATE_MS,
  photos: photosProp,
}: PhotosWidgetProps) {
  const router = useRouter();
  const [photos, setPhotos] = useState<WallPhoto[]>(photosProp ?? []);
  const [state, setState] = useState<FeedState>(photosProp ? "ready" : "loading");
  const [shown, setShown] = useState<WallPhoto | null>(photosProp?.[0] ?? null);
  const [incoming, setIncoming] = useState<WallPhoto | null>(null);
  /** Flips the incoming layer to full opacity one frame after it mounts. */
  const [armed, setArmed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(
    // Read once at init rather than setting state inside the effect below,
    // which would render the tile twice on mount.
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const cursorRef = useRef(0);
  /** The id currently composited. Rotation must never re-pick it. */
  const shownIdRef = useRef<string | null>(photosProp?.[0]?.id ?? null);
  const recentRef = useRef<string[]>([]);
  const mountedRef = useRef(true);
  const photosRef = useRef<WallPhoto[]>(photosProp ?? []);
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
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const load = useCallback(async (recent: string[], keepCurrent: boolean) => {
    const query = new URLSearchParams({ limit: String(QUEUE_SIZE) });
    if (recent.length > 0) query.set("recent", recent.join(","));
    try {
      const res = await fetch(`/api/photos?${query.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`photos feed returned ${res.status}`);
      const data = await res.json();
      const list: WallPhoto[] = Array.isArray(data?.photos) ? data.photos : [];
      if (!mountedRef.current) return;
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
      }
    } catch {
      if (!mountedRef.current) return;
      // A missing collection, a PocketBase restart, a network blip: say so.
      // Never substitute a placeholder image — this is the family's wall.
      setState((current) => (current === "ready" ? "ready" : "error"));
    }
  }, []);

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

    let next = queue[cursorRef.current % queue.length];
    cursorRef.current += 1;
    // Never "rotate" onto the picture already on screen: a duplicate layer key
    // and a frame where nothing changed is exactly what the family would see.
    if (next && next.id === shownIdRef.current) {
      next = queue[cursorRef.current % queue.length];
      cursorRef.current += 1;
    }
    if (!next) return;

    recentRef.current = [...recentRef.current, next.id].slice(-RECENT_MEMO);

    try {
      const probe = new Image();
      probe.decoding = "async";
      probe.src = next.url;
      const decodable = probe as HTMLImageElement & { decode?: () => Promise<void> };
      if (typeof decodable.decode === "function") {
        await decodable.decode();
      } else if (!probe.complete) {
        await new Promise<void>((resolve, reject) => {
          probe.onload = () => resolve();
          probe.onerror = () => reject(new Error("decode failed"));
        });
      }
    } catch {
      return; // keep the current photo rather than show a broken one
    }

    if (!mountedRef.current) return;
    setArmed(false);
    setIncoming(next);

    // Walked the whole queue: ask for a fresh ordering that holds back what
    // the wall just showed, instead of looping visibly.
    if (cursorRef.current >= queue.length) {
      void load(recentRef.current, true);
    }
  }, [load]);

  useEffect(() => {
    if (state !== "ready" || photos.length < 2) return;
    const id = window.setInterval(() => {
      if (document.hidden) return; // nobody is watching a sleeping panel
      void advance();
    }, rotateMs);
    return () => window.clearInterval(id);
  }, [advance, photos.length, rotateMs, state]);

  useEffect(() => {
    if (!incoming) return;
    const frame = window.requestAnimationFrame(() => setArmed(true));
    const commit = window.setTimeout(() => {
      if (!mountedRef.current) return;
      shownIdRef.current = incoming.id;
      setShown(incoming);
      setIncoming(null);
      setArmed(false);
    }, reduceMotion ? 60 : CROSSFADE_MS + 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(commit);
    };
  }, [incoming, reduceMotion]);

  const shell = `wall-photo-tile relative overflow-hidden ${className}`.trim();

  if (state === "error") {
    return (
      <div className={shell}>
        <EmptyState
          flat
          icon="📡"
          title="Photos unavailable"
          description="The family photo library can't be reached right now."
        />
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className={`${shell} wall-photo-skeleton`} aria-busy="true" aria-label="Loading photos">
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

  return (
    <div className={shell}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={shown.id}
        src={shown.url}
        alt={altFor(shown)}
        draggable={false}
        className="wall-photo-img"
      />
      {incoming && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={incoming.id}
          src={incoming.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={`wall-photo-img wall-photo-incoming${armed ? " is-armed" : ""}${reduceMotion ? " is-instant" : ""}`}
        />
      )}
      <div className="wall-photo-scrim" aria-hidden="true" />
      {caption && (
        <p className="wall-photo-caption" translate="no">
          {caption}
        </p>
      )}
    </div>
  );
}
