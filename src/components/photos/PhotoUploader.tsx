"use client";

import { useCallback, useRef, useState } from "react";
import SoftButton from "@/components/ui/SoftButton";
import { resizeForWall } from "@/lib/photos/resize";
import { MAX_ORIGINAL_BYTES, isAllowedImageType } from "@/lib/photos/upload-limits";

/**
 * Add family photos from any device on the network.
 *
 * The browser resizes before uploading (see `lib/photos/resize`) and sends both
 * copies: the untouched original for the archive and a ~1600px JPEG for the
 * panel. If the browser can't decode the file — HEIC from an iPhone is the
 * common one — the original still uploads and the wall serves it directly; a
 * photo we couldn't resize is still a photo we kept.
 */

type ItemState = "waiting" | "resizing" | "uploading" | "done" | "failed";

interface QueueItem {
  key: string;
  file: File;
  state: ItemState;
  /** True when the resized copy could not be produced and only the original went up. */
  originalOnly: boolean;
  /**
   * Caption/album frozen when the file was QUEUED. A retry runs through the
   * same closure path as a fresh upload, so reading the live inputs there
   * would stamp whatever the family is typing NOW onto an older file.
   */
  caption: string;
  album: string;
  error?: string;
}

function label(state: ItemState): string {
  switch (state) {
    case "waiting": return "Queued";
    case "resizing": return "Preparing…";
    case "uploading": return "Uploading…";
    case "done": return "Added to the wall";
    case "failed": return "Failed";
  }
}

export default function PhotoUploader({ onUploaded }: { onUploaded?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [caption, setCaption] = useState("");
  const [album, setAlbum] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = useCallback((key: string, next: Partial<QueueItem>) => {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...next } : item)));
  }, []);

  /**
   * Upload one batch and MERGE it into the status list by `key`. Wholesale
   * `setItems(queue)` here wiped every earlier row — the successful uploads
   * vanished from the list the moment a retry started.
   */
  const run = useCallback(
    async (queue: QueueItem[]) => {
      if (queue.length === 0) return;
      setItems((list) => {
        const next = [...list];
        for (const item of queue) {
          const at = next.findIndex((row) => row.key === item.key);
          if (at >= 0) next[at] = item;
          else next.push(item);
        }
        return next;
      });
      setBusy(true);

      for (const item of queue) {
        if (!isAllowedImageType(item.file.type)) {
          patch(item.key, { state: "failed", error: "Not an image" });
          continue;
        }
        if (item.file.size > MAX_ORIGINAL_BYTES) {
          patch(item.key, { state: "failed", error: "Larger than 100MB" });
          continue;
        }

        patch(item.key, { state: "resizing" });
        const resized = await resizeForWall(item.file);

        patch(item.key, { state: "uploading" });
        const form = new FormData();
        form.set("original", item.file, item.file.name);
        if (resized) {
          form.set("wall", resized.blob, item.file.name.replace(/\.[^.]+$/, "") + ".jpg");
          form.set("width", String(resized.width));
          form.set("height", String(resized.height));
        }
        if (item.caption) form.set("caption", item.caption);
        if (item.album) form.set("album", item.album);
        // No EXIF reader in the bundle: the file's own clock is the best
        // available "taken" date, and beats using the upload date.
        form.set("takenAt", new Date(item.file.lastModified).toISOString());

        try {
          const res = await fetch("/api/photos/upload", { method: "POST", body: form });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body?.ok === false) {
            throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
          }
          patch(item.key, { state: "done", originalOnly: !resized });
        } catch (error) {
          patch(item.key, {
            state: "failed",
            error: error instanceof Error ? error.message : "Upload failed",
          });
        }
      }

      setBusy(false);
      onUploaded?.();
    },
    [onUploaded, patch],
  );

  const send = useCallback(
    (files: File[]) => {
      // Snapshot at ENQUEUE time: everything queued in this batch carries the
      // caption/album that was in the inputs when the batch started.
      const snapCaption = caption.trim();
      const snapAlbum = album.trim();
      void run(
        files.map((file, index) => ({
          key: `${file.name}-${file.lastModified}-${index}`,
          file,
          state: "waiting" as const,
          originalOnly: false,
          caption: snapCaption,
          album: snapAlbum,
        })),
      );
    },
    [caption, album, run],
  );

  /** Retry keeps each failed row's key (merge replaces it) and its own snapshot. */
  const retryFailed = useCallback(() => {
    void run(
      items
        .filter((item) => item.state === "failed")
        .map((item): QueueItem => ({ ...item, state: "waiting", error: undefined })),
    );
  }, [items, run]);

  const pick = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length > 0 && !busy) send(files);
  };

  return (
    <div className="widget-card p-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose photos to upload"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!busy && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          pick(event.dataTransfer?.files ?? null);
        }}
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${
          dragging
            ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10"
            : "border-white/15 bg-[var(--color-surface-0)]/30"
        }`}
      >
        <span className="text-3xl" aria-hidden="true">📸</span>
        <p className="mt-2 text-sm font-semibold text-text-primary">
          {busy ? "Uploading…" : "Drop photos here, or tap to choose"}
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          The full-quality original is kept; the panel gets a resized copy.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          // The dropzone wrapper already is the button (role/tabIndex/label
          // above); a second stop in the tab order — or a second announcement —
          // would be noise. Clicks still reach it via the wrapper's plumbing.
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-secondary">Caption</span>
          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Beach day"
            maxLength={200}
            className="w-full rounded-xl border border-white/10 bg-[var(--color-surface-0)]/60 px-3 py-2 text-sm text-text-primary outline-none focus:border-[var(--color-accent-selected)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-secondary">Album</span>
          <input
            value={album}
            onChange={(event) => setAlbum(event.target.value)}
            placeholder="Oregon 2026"
            maxLength={80}
            className="w-full rounded-xl border border-white/10 bg-[var(--color-surface-0)]/60 px-3 py-2 text-sm text-text-primary outline-none focus:border-[var(--color-accent-selected)]"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-text-secondary">
        Applied to every file in this batch. An album keeps one trip from taking over the wall.
      </p>

      {items.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate text-text-primary">{item.file.name}</span>
              <span
                className={`shrink-0 text-xs font-semibold ${
                  item.state === "failed"
                    ? "text-[var(--color-accent-rose)]"
                    : item.state === "done"
                      ? "text-[var(--color-accent-mint)]"
                      : "text-text-secondary"
                }`}
              >
                {label(item.state)}
                {item.error ? ` — ${item.error}` : ""}
                {item.originalOnly && item.state === "done" ? " (original only)" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {items.some((item) => item.state === "failed") && (
        <SoftButton
          className="mt-3"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={retryFailed}
        >
          Retry failed
        </SoftButton>
      )}
    </div>
  );
}
