"use client";

import SigmaImage from "./SigmaImage";

/**
 * EmojiText — render a member's emoji field safely inline.
 *
 * The member `emoji` field can hold either a plain emoji OR a photo avatar
 * stored as a base64 data URL (`members.emoji`, see pb-seed.ts). Rendering
 * that value as raw text dumps the whole base64 string onto the page —
 * the "letterings" bug class. This component routes photo values through
 * SigmaImage and renders everything else as text.
 */

/** True when the emoji field is a photo (data URL or remote image), not an emoji glyph. */
export function isPhotoEmoji(emoji: unknown): boolean {
  return typeof emoji === "string" && (emoji.startsWith("data:") || emoji.startsWith("http"));
}

/**
 * A text-safe emoji for string contexts (share text, toasts, select
 * options, aria labels): photo values fall back to 👤 so no base64 ever
 * reaches a string.
 */
export function textEmojiOrFallback(emoji: unknown, fallback = "👤"): string {
  return !isPhotoEmoji(emoji) && typeof emoji === "string" && emoji ? emoji : fallback;
}

interface EmojiTextProps {
  emoji: unknown;
  alt?: string;
  /** Classes for the outer wrapper — apply to BOTH photo and text renders (e.g. "text-2xl"). */
  className?: string;
}

/** Inline render: photo → SigmaImage circle; everything else → the raw text. */
export function EmojiText({ emoji, alt = "", className }: EmojiTextProps) {
  if (isPhotoEmoji(emoji)) {
    // Caller className replaces the default inline sizing wholesale.
    return (
      <span className={`inline-block rounded-full overflow-hidden shrink-0 align-middle ${className ?? "w-4 h-4"}`}>
        <SigmaImage src={emoji as string} alt={alt} shape="circle" />
      </span>
    );
  }
  return <span className={className}>{emoji as string}</span>;
}

export default EmojiText;
