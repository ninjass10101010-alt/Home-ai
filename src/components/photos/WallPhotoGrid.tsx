"use client";

/* eslint-disable react-hooks/set-state-in-effect -- the grid's state is the
   feed result and the optimistic toggle; both arrive from an async boundary. */
import { useCallback, useEffect, useState } from "react";
import type { WallPhoto } from "@/db/features/photos";

/**
 * What's on the wall, and the one-tap way to take a picture off it.
 *
 * `showOnWall` rather than delete: a parent taking down a bad shot is a
 * different decision from destroying it, and the toggle is the only moderation
 * surface that works at the kitchen counter. Hidden photos stay in the library
 * and stay listed here, dimmed, so "off" is visible and reversible.
 */

interface WallPhotoGridProps {
  /** Bump to refetch (the uploader increments it after a successful upload). */
  refreshToken?: number;
}

export default function WallPhotoGrid({ refreshToken = 0 }: WallPhotoGridProps) {
  const [photos, setPhotos] = useState<WallPhoto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/photos?all=1&limit=40", { cache: "no-store" });
      if (!res.ok) throw new Error(`feed returned ${res.status}`);
      const data = await res.json();
      setPhotos(Array.isArray(data?.photos) ? data.photos : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const toggle = async (photo: WallPhoto) => {
    const next = photo.showOnWall === false;
    setPendingIds((ids) => [...ids, photo.id]);
    // Optimistic: the tap should feel immediate on a touch screen, and a
    // failure is corrected by the rollback below rather than by a spinner.
    setPhotos((list) => list.map((p) => (p.id === photo.id ? { ...p, showOnWall: next } : p)));
    try {
      const res = await fetch("/api/photos", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: photo.id, showOnWall: next }),
      });
      if (!res.ok) throw new Error(`patch returned ${res.status}`);
    } catch {
      setPhotos((list) => list.map((p) => (p.id === photo.id ? { ...p, showOnWall: !next } : p)));
    } finally {
      setPendingIds((ids) => ids.filter((id) => id !== photo.id));
    }
  };

  if (status === "error") {
    return (
      <p className="rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 p-4 text-sm text-text-secondary">
        The photo library can’t be reached right now.
      </p>
    );
  }

  if (status === "loading") {
    return <p className="text-sm text-text-secondary">Loading photos…</p>;
  }

  if (photos.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        Nothing uploaded yet. Add the first picture above and it lands on the wall.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {photos.map((photo) => {
        const shown = photo.showOnWall !== false;
        const busy = pendingIds.includes(photo.id);
        return (
          <li key={photo.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggle(photo)}
              aria-pressed={shown}
              title={shown ? "On the wall — tap to hide" : "Hidden — tap to show on the wall"}
              className="group relative block aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.caption || "Family photo"}
                loading="lazy"
                className={`h-full w-full object-cover transition-opacity ${shown ? "opacity-100" : "opacity-30"}`}
              />
              <span
                className={`absolute inset-x-1 bottom-1 rounded-lg px-1.5 py-1 text-xs font-bold uppercase tracking-wide ${
                  shown ? "bg-black/55 text-white" : "bg-[var(--color-surface-2)]/85 text-text-secondary"
                }`}
              >
                {shown ? "On wall" : "Hidden"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
