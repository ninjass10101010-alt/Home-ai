"use client";

import { useRef, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import PhotoCropEditor from "@/components/profile/PhotoCropEditor";

interface EmojiCategory {
  id: string;
  label: string;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "faces",
    label: "Faces",
    emojis: ["😀", "😄", "😁", "😆", "😂", "🤣", "😊", "😍", "🥰", "🤩", "😎", "🥳", "😇", "🙃", "😋", "😜", "🤔", "😴", "😮", "😢", "😭", "😡", "🥹", "🫡", "😺", "🙈"],
  },
  {
    id: "people",
    label: "People",
    emojis: ["👨", "👩", "🧑", "👧", "🧒", "👶", "👴", "👵", "👱", "👳", "👷", "👮", "🕵️", "🧑‍🎤", "🧑‍🚀", "🧑‍⚕️", "🧓", "👦", "👸", "🤴"],
  },
  {
    id: "pets",
    label: "Pets & animals",
    emojis: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦄", "🐝", "🦋", "🐢", "🐠", "🐙", "🦉", "🦡", "🐺", "🦒"],
  },
  {
    id: "nature",
    label: "Nature",
    emojis: ["🌸", "🌺", "🌻", "🌹", "🌷", "🌼", "🌲", "🌳", "🍀", "🌵", "🍄", "☀️", "🌙", "⭐", "🌈", "🌊", "⛰️", "🌋", "❄️", "🔥", "💧", "🌠"],
  },
  {
    id: "food",
    label: "Food",
    emojis: ["🍎", "🍌", "🍊", "🍇", "🍉", "🫐", "🍓", "🍔", "🍕", "🍟", "🌮", "🍩", "🍪", "🍰", "🥧", "☕", "🧃", "🍦", "🍫", "🥨"],
  },
  {
    id: "fun",
    label: "Fun & things",
    emojis: ["⚽", "🏀", "🏈", "🎾", "🎮", "🎸", "🎧", "🎨", "✏️", "📚", "🚲", "🛹", "🚗", "✈️", "🧸", "🎁", "🎀", "👑", "🌟", "🎯", "🏆", "🚀", "🎪", "🤖", "👻", "🧊", "💎", "🐚"],
  },
];

const MAX_AVATAR_DIMENSION = 256;
const EDITOR_MAX_DIM = 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Centered-square crop of the source bitmap. The reposition editor starts from this
// default framing (centered, zoom = 1) — kept exported so its unit tests hold.
export function centerCropSquare(srcWidth: number, srcHeight: number) {
  const side = Math.min(srcWidth, srcHeight);
  return {
    side,
    sx: Math.floor((srcWidth - side) / 2),
    sy: Math.floor((srcHeight - side) / 2),
  };
}

// Aspect-preserving resize to ≤ maxDim. Produces the uncropped source shown in the
// reposition editor (no crop here — the editor crops to a square on Apply).
async function resizeImageToDataUrl(file: File, maxDim: number): Promise<string> {
  const buffer = await file.arrayBuffer();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: file.type }));
  } catch {
    throw new Error("Could not read that image. Try a different one.");
  }

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not resize that image.");

  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/webp", 0.85);
  if (dataUrl === "data:,") throw new Error("Could not resize that image.");
  return dataUrl;
}

interface AvatarPickerProps {
  value: string;
  onChange: (next: string) => void;
  fallbackEmoji?: string;
}

export default function AvatarPicker({ value, onChange, fallbackEmoji }: AvatarPickerProps) {
  const defaultEmoji = fallbackEmoji || "😊";
  const [activeCategory, setActiveCategory] = useState<string>("faces");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const category = EMOJI_CATEGORIES.find((c) => c.id === activeCategory) ?? EMOJI_CATEGORIES[0];
  const isPhoto = value.startsWith("data:") || value.startsWith("http");

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
      setUploadError("Please choose a PNG, JPG, WebP, or GIF photo.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError("That photo is over 5MB. Choose a smaller one.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      // Resize to an uncropped editor source, then open the reposition editor.
      const src = await resizeImageToDataUrl(file, EDITOR_MAX_DIM);
      setEditorSrc(src);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not upload that photo.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name="Preview" color="green" emoji={value || "😊"} size="base" variant="emoji" />
        <div className="text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{isPhoto ? "Photo avatar" : "Emoji avatar"}</span>
          <span className="mt-0.5 block">Shown on Home, Tasks, and the leaderboard.</span>
        </div>
      </div>

      {!isPhoto && (
        <div>
          <div className="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar">
            {EMOJI_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategory(c.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeCategory === c.id
                    ? "bg-[var(--color-accent-selected)] text-white"
                    : "glass-subtle text-text-secondary hover:text-text-primary"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid max-h-40 grid-cols-7 gap-1.5 overflow-y-auto pr-1">
            {category.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onChange(emoji)}
                aria-label={`Choose ${emoji}`}
                className={`grid aspect-square place-items-center rounded-2xl text-xl transition-colors ${
                  value === emoji
                    ? "bg-[var(--color-accent-selected)]"
                    : "bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-1)]"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="tap-sm flex-1 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-3 py-2.5 text-sm font-semibold text-text-primary transition hover:bg-[var(--color-surface-1)] disabled:opacity-50"
        >
          {uploading ? "Resizing…" : "📷 Upload photo"}
        </button>
        {isPhoto && (
          <button
            type="button"
            onClick={() => {
              setEditorSrc(null);
              onChange(defaultEmoji);
            }}
            className="tap-sm flex-1 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-3 py-2.5 text-sm font-semibold text-text-primary transition hover:bg-[var(--color-surface-1)]"
          >
            🙂 Use emoji
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {uploadError && <p className="text-xs font-medium text-rose-300">{uploadError}</p>}

      {editorSrc && (
        <PhotoCropEditor
          src={editorSrc}
          onApply={(cropped) => {
            onChange(cropped);
            setEditorSrc(null);
          }}
          onCancel={() => setEditorSrc(null)}
        />
      )}
    </div>
  );
}