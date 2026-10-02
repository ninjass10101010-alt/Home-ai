"use client";

/**
 * The turn's reasoning transcript, collapsed by default and re-openable.
 * Display-only (spec §4.2 / §8): the text lives in the chat store / on the
 * finished message, never in persistence.
 *
 * Fully controlled — the store is the source of truth for the TEXT, the parent
 * owns the toggle. That is what lets the same component open automatically
 * while Consuela thinks and auto-collapse on the first answer token.
 *
 * Capped with its own scroll: a GLM-class think runs to thousands of
 * characters, and an uncapped one would push the answer off-screen.
 */
export default function ThinkingDisclosure({
  text,
  open,
  onOpenChange,
}: {
  text: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  if (!text.trim()) return null;
  return (
    <div data-testid="thinking-disclosure" className="self-start max-w-full">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="hit-44 inline-flex items-center gap-1.5 rounded-full glass-subtle px-3 min-h-[44px] text-xs text-text-secondary"
      >
        <span aria-hidden="true">💭</span>
        {open ? "Hide thinking" : "Show thinking"}
      </button>
      {open && (
        <div
          data-testid="thinking-transcript"
          className="mt-1.5 max-h-[40vh] overflow-y-auto overscroll-contain rounded-2xl glass-subtle px-3 py-2 text-xs leading-relaxed text-text-secondary whitespace-pre-wrap"
        >
          {text}
        </div>
      )}
    </div>
  );
}
