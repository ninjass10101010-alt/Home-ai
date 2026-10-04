"use client";

import type { ReactNode } from "react";
import SoftButton from "./SoftButton";
import { useInsideCard } from "./inside-card-context";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Drop the nested glass-card chrome (border/bg/blur/min-height) when rendering inside a widget body. */
  flat?: boolean;
}

export default function EmptyState({ icon = "✨", title, description, actionLabel, onAction, flat = false }: EmptyStateProps) {
  // Already inside a card body: keep the reserve height so the state sits
  // centred in generous air, but drop the border / fill / blur. The bordered
  // variant nested inside a SectionCard stacked a second glass panel within
  // the first — three rounded boxes on a phone, and the inner one's fill was
  // *lighter* than its parent's, so the elevation read backwards.
  const insideCard = useInsideCard();
  const chrome = !flat && !insideCard;
  // 18 → 12. The caption was `text-sm`/`leading-6` (a 4px step under the
  // title, in a `max-w-sm` measure), which made an empty state read as a
  // paragraph instead of a state.
  //
  // `h-full` on the STANDALONE flat variant only: PhotosWidget's wall tile is
  // a `row-span-2` cell roughly 780px tall holding a three-line state, and the
  // state sat pinned to the top of it — ~600px of dead tile below the copy, so
  // the emptiest object on the wall read as a rendering failure rather than a
  // state. Filling the parent and letting the existing `justify-center` place it
  // puts the state on the tile's optical centre. The inside-card variant keeps
  // its reserved height instead: there the card's own body box is the parent
  // and `min-h-56` is what holds the rhythm.
  const box = chrome
    ? "min-h-56 rounded-2xl border border-border bg-[var(--color-surface-0)]/30 p-8 backdrop-blur-xl"
    : insideCard
      ? "min-h-56 p-2"
      : "h-full py-2";

  return (
    <div data-empty-state className={`flex flex-col items-center justify-center text-center ${box}`}>
      {/* 30px, the same glyph scale `WidgetCard`'s seated badge was normalised
          to. At `text-5xl` this was a 48px photographic emoji — a sticker with
          its own lighting and palette — parked above 14px type on every empty
          state in the app, which is the single loudest emoji-vs-icon mismatch
          a wall display shows. */}
      <div className="mb-4 text-[30px] leading-none">{icon}</div>
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 max-w-xs text-center text-xs leading-5 text-text-secondary">{description}</p>
      {actionLabel && onAction && (
        <SoftButton onClick={onAction} className="mt-5" size="md">
          {actionLabel}
        </SoftButton>
      )}
    </div>
  );
}