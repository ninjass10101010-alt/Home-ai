"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Modal from "@/components/ui/Modal";
import TextField from "@/components/ui/TextField";
import SoftButton from "@/components/ui/SoftButton";
import Chip from "@/components/ui/Chip";
import type { GroceryItem } from "@/types/meals";

interface ClemAssistantProps {
  groceryItems: GroceryItem[];
  pantryItems: any[]; // reserved for future pantry-aware prompts
  storeContext: string;
  addGroceryItem: (
    name: string,
    category?: string,
    priority?: string,
    emoji?: string,
    quantity?: string,
    notes?: string
  ) => Promise<void>; // reserved for future add-to-list actions
  showToast: (msg: string) => void;
}

interface ClemMessage {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS: { label: string; send?: string; toast?: string }[] = [
  { label: "What should I order?", send: "What should I order?" },
  { label: "Compare store prices", toast: "💰 Use the Compare Prices button above the list!" },
  { label: "Order my list", toast: "📤 Use the Order section below to send to Instacart!" },
];

const subscribeNoop = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;

export default function ClemAssistant({ groceryItems, storeContext, showToast }: ClemAssistantProps) {
  const mounted = useSyncExternalStore(subscribeNoop, clientTrue, serverFalse);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ClemMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  const systemPrompt = useMemo(() => {
    const list = groceryItems
      .filter((i) => i.needed !== false)
      .map((i) => (i.quantity ? `${i.name} (${i.quantity})` : i.name))
      .join(", ");
    return `You are Clem, a smart grocery shopping assistant. You know the user's grocery list and store assignments. You can help them: 1) decide what to buy by suggesting items based on their list, 2) compare prices across their stores, 3) help them order via Instacart. Keep responses short and helpful. Current grocery list: ${list || "empty"}. Current stores: ${storeContext || "none assigned"}.`;
  }, [groceryItems, storeContext]);

  // Keep the conversation pinned to the latest message.
  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/hermes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: messages.slice(-6), system: systemPrompt, agent: "clem" }),
      });
      if (!res.ok) throw new Error(`Chat request failed (${res.status})`);
      const data = await res.json();
      const reply = data.content || data.reply || "Sorry, I didn't catch that.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      showToast("Couldn't reach Clem right now — try again");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickPrompt = (prompt: (typeof QUICK_PROMPTS)[number]) => {
    if (prompt.send) {
      void send(prompt.send);
    } else if (prompt.toast) {
      showToast(prompt.toast);
    }
  };

  return (
    <>
      <style>{`
        @keyframes clem-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent-selected) 0%, transparent); }
          50% { box-shadow: 0 0 18px 4px color-mix(in srgb, var(--color-accent-selected) 40%, transparent); }
        }
        @media (prefers-reduced-motion: reduce) {
          .clem-fab { animation: none !important; }
        }
      `}</style>

      {mounted && !open && (
        <button
          type="button"
          aria-label="Ask Clem"
          onClick={() => setOpen(true)}
          className="clem-fab glass-strong tap fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full text-2xl"
          style={{ animation: "clem-pulse 3s ease-in-out infinite" }}
        >
          🛒
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Clem — Grocery Assistant">
        <div className="mb-3">
          <p className="text-sm font-semibold text-text-primary">🛒 Clem · Smart grocery helper</p>
          <p className="mt-0.5 text-xs text-text-secondary">I know your list and stores — ask me anything</p>
        </div>

        {messages.length > 0 && (
          <div ref={historyRef} className="mb-3 max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent-button)] px-3 py-2 text-sm text-white"
                      : "max-w-[85%] rounded-2xl rounded-bl-md bg-[var(--color-surface-2)] px-3 py-2 text-sm text-text-primary"
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-[var(--color-surface-2)] px-3 py-2 text-sm italic text-text-secondary">
                  Clem is thinking…
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mb-3 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((p) => (
            <Chip key={p.label} size="sm" tone="accent" onClick={() => handleQuickPrompt(p)} disabled={loading}>
              {p.label}
            </Chip>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask Clem about your groceries…"
              aria-label="Message Clem"
              disabled={loading}
            />
          </div>
          <SoftButton
            variant="primary"
            size="md"
            loading={loading}
            disabled={!input.trim()}
            onClick={() => void send(input)}
            aria-label="Send message to Clem"
          >
            Send
          </SoftButton>
        </div>
      </Modal>
    </>
  );
}
