"use client";

import { useCallback, useState } from "react";
import SoftButton from "@/components/ui/SoftButton";

/**
 * The memory chip.
 *
 * Two states, one component:
 *   stored   — "Remembered: <fact> · Undo"  (the fact is already saved)
 *   proposed — "Remember this? · Remember / Not now"  (nothing is saved yet)
 *
 * The chip is the ONLY thing that turns a proposal into a stored fact, and
 * the ONLY thing that removes an auto-stored one. Chat itself never writes a
 * memory without the family seeing it.
 */

export interface MemoryProposal {
  tool: "remember_memory";
  /** "stored" = already saved (Undo offered). "proposed" = awaiting a tap. */
  mode?: "stored" | "proposed";
  /** The stored row id — present only in "stored" mode. */
  id?: string;
  operationId?: string;
  args: { content: string; category?: string; person?: string; subject?: string; kind?: string };
}

export function isMemoryProposal(value: unknown): value is MemoryProposal {
  const p = value as MemoryProposal | null;
  return (
    !!p &&
    typeof p === "object" &&
    p.tool === "remember_memory" &&
    !!p.args &&
    typeof p.args.content === "string" &&
    p.args.content.trim().length > 0
  );
}

export default function RememberedChip({ proposal }: { proposal: MemoryProposal }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const stored = proposal.mode !== "proposed";

  const onRemember = useCallback(async () => {
    setState("busy");
    try {
      const res = await fetch("/api/family-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: proposal.args.content,
          category: proposal.args.category ?? "note",
          person: proposal.args.person ?? "",
          key: proposal.args.subject ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setState("done");
      setMessage("Remembered.");
    } catch {
      setState("error");
      setMessage("Couldn't save that — try again.");
    }
  }, [proposal.args]);

  const onUndo = useCallback(async () => {
    if (!proposal.id) return;
    setState("busy");
    try {
      const res = await fetch(`/api/family-memory/${proposal.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setState("done");
      setMessage("Forgotten.");
    } catch {
      setState("error");
      setMessage("Couldn't remove that — try again.");
    }
  }, [proposal.id]);

  const onNotNow = useCallback(() => {
    setState("done");
    setMessage("Not saved.");
  }, []);

  return (
    <div className="mt-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
      <p className="text-[var(--color-text-primary)]">
        {stored ? "Remembered: " : "Remember this? "}
        <span className="font-medium">{proposal.args.content}</span>
      </p>
      {message ? <p role="status" className="mt-1 text-[var(--color-text-muted)]">{message}</p> : null}
      {state !== "busy" && state !== "done" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {stored ? (
            <SoftButton onClick={onUndo} aria-label="Undo remembered fact">Undo</SoftButton>
          ) : (
            <>
              <SoftButton onClick={onRemember} aria-label="Remember this fact">Remember</SoftButton>
              <SoftButton onClick={onNotNow} aria-label="Not now">Not now</SoftButton>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
