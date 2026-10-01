"use client";

import { useCallback, useRef, useState } from "react";
import SoftButton from "@/components/ui/SoftButton";
import { resizeForWall } from "@/lib/photos/resize";

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
  error?: string;
}

const MAX_BYTES = 20 * 1024 * 1024;

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

  const send = useCallback(
    async (files: File[]) => {
      const queue: QueueItem[] = files.map((file, index) => ({
        key: `${file.name}-${file.lastModified}-${index}`,
        file,
        state: "waiting",
        originalOnly: false,
      }));
      setItems(queue);
      setBusy(true);

      for (const item of queue) {
        if (!item.file.type.startsWith("image/")) {
          patch(item.key, { state: "failed", error: "Not an image" });
          continue;
        }
        if (item.file.size > MAX_BYTES) {
          patch(item.key, { state: "failed", error: "Larger than 20MB" });
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
        if (caption.trim()) form.set("caption", caption.trim());
        if (album.trim()) form.set("album", album.trim());
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
    [caption, album, onUploaded, patch],
  );

  const pick = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length > 0 && !busy) void send(files);
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
          onClick={() => void send(items.filter((i) => i.state === "failed").map((i) => i.file))}
        >
          Retry failed
        </SoftButton>
      )}
    </div>
  );
}
