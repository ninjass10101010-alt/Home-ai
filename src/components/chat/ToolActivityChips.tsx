"use client";

import type { ToolEvent as ChatToolEvent } from "@/lib/chat-stream";

const STATE_GLYPH = { running: "⏳", ok: "✅", error: "❌" } as const;

/**
 * The wire shape from `@/lib/chat-stream`, ALIASED rather than re-declared.
 * `src/lib/consuela/todays-events.ts` exports an unrelated `ToolEvent` (a
 * calendar event), so this name must never be re-exported bare; and a local
 * copy of the interface could drift from the stream with nothing failing.
 */
export type ToolEventView = ChatToolEvent;

function toolLabel(name: string): string {
  return name
    .replace(/^(get|list)_/, "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * One chip per tool call for the turn. Display-only (spec §4.2 / §8).
 *
 * The state never depends on colour — and never depends on an attribute the
 * assistive tech is free to drop either. This <span> has no `role`, so it maps
 * to implicit `generic`, for which ARIA 1.2 marks naming PROHIBITED: browsers
 * and screen readers are not obliged to announce `aria-label` here at all. So
 * the state that actually reaches a screen reader is the `sr-only` WORD below;
 * `aria-label` is kept only as belt-and-braces and `data-state` for the DOM and
 * tests. The word is the RAW wire state, not a narrative: `state: "error"`
 * covers routine refusals ("Already completed — waiting for parent approval",
 * "task is already pending"), so nothing here may imply a crash.
 *
 * Hand-rolled rather than the `Chip` primitive: `Chip`'s `as="span"` branch
 * drops `{...props}`, so it cannot carry the state attributes at all. Fixing
 * the primitive and converging here is Phase-5 work.
 */
export default function ToolActivityChips({ events }: { events: ToolEventView[] }) {
  if (!events.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 self-start" data-testid="tool-activity">
      {events.map((e, i) => (
        <span
          key={`${e.name}-${i}`}
          data-state={e.state}
          aria-label={`${toolLabel(e.name)}: ${e.state}`}
          className="inline-flex items-center gap-1 rounded-full glass-subtle px-2.5 min-h-[24px] text-xs text-text-secondary"
        >
          <span aria-hidden="true">{STATE_GLYPH[e.state]}</span>
          {toolLabel(e.name)}
          <span className="sr-only"> — {e.state}</span>
        </span>
      ))}
    </div>
  );
}
