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
 * The state is exposed three ways so it never depends on colour: the glyph,
 * `data-state` for the DOM, and the `aria-label` — which reports the RAW wire
 * state, not a narrative. `state: "error"` covers routine refusals ("Already
 * completed — waiting for parent approval"), so nothing here may imply a crash.
 */
export default function ToolActivityChips({ events }: { events: ToolEventView[] }) {
  if (!events.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 self-start" data-testid="tool-activity">
      {events.map((e, i) => (
        <span
          key={`${e.name}-${e.state}-${i}`}
          data-state={e.state}
          aria-label={`${toolLabel(e.name)}: ${e.state}`}
          className="inline-flex items-center gap-1 rounded-full glass-subtle px-2.5 min-h-[24px] text-xs text-text-secondary"
        >
          <span aria-hidden="true">{STATE_GLYPH[e.state]}</span>
          {toolLabel(e.name)}
        </span>
      ))}
    </div>
  );
}
