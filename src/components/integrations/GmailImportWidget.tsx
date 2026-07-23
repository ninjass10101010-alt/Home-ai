/**
 * GmailImportWidget — Auto-import events from forwarded emails.
 *
 * Shows emails that may contain calendar events (school newsletters,
 * sports schedules, doctor appointments). Parent reviews and approves.
 *
 * Requires: Gmail connected via Settings → Connections.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import { isConnected, getCredentials } from "@/lib/connections/store";

interface ExtractedEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  location?: string;
  source: string;
  type: string;
}

export default function GmailImportWidget() {
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<ExtractedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [approved, setApproved] = useState<Set<string>>(new Set());

  useEffect(() => {
    setEnabled(isConnected("gmail"));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    scanForEvents();
  }, [enabled]);

  const scanForEvents = async () => {
    setLoading(true);
    try {
      // In production, this calls Composio Gmail API to search for
      // emails from common school/sports/medical senders, then uses
      // Hermes AI to extract events from the email body.
      // For demo, show simulated events.
      setEvents([
        {
          id: "evt-1",
          title: "Field Trip to Science Museum",
          date: "Oct 15, 2026",
          time: "9:00 AM – 2:00 PM",
          location: "Detroit Science Center",
          source: "Whitehall Elementary",
          type: "school",
        },
        {
          id: "evt-2",
          title: "Picture Day",
          date: "Oct 22, 2026",
          time: "All Day",
          source: "Whitehall Elementary",
          type: "school",
        },
        {
          id: "evt-3",
          title: "Soccer Game vs Lakers",
          date: "Sat, Oct 18",
          time: "10:00 AM",
          location: "Whitehall Community Field",
          source: "Youth Soccer League",
          type: "sports",
        },
      ]);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = useCallback((eventId: string) => {
    setApproved((prev) => new Set(prev).add(eventId));
    // In production, this adds the event to Google Calendar
  }, []);

  const handleApproveAll = useCallback(() => {
    const allIds = new Set(events.map((e) => e.id));
    setApproved(allIds);
  }, [events]);

  const handleSkip = useCallback((eventId: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  }, []);

  if (!enabled) return null;

  const typeConfig: Record<string, { emoji: string; color: string }> = {
    school: { emoji: "🏫", color: "rgba(59, 130, 246, 0.15)" },
    sports: { emoji: "⚽", color: "rgba(74, 222, 128, 0.15)" },
    medical: { emoji: "🏥", color: "rgba(244, 63, 94, 0.15)" },
  };

  return (
    <Surface variant="glass-subtle" radius="xl" padding="none">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📧</span>
            <h3 className="text-sm font-bold text-text-primary">Smart Inbox</h3>
            {events.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)]">
                {events.length - approved.size} new
              </span>
            )}
          </div>
          {events.length > 1 && (
            <SoftButton size="sm" variant="secondary" onClick={handleApproveAll}>
              Approve All
            </SoftButton>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <div className="w-4 h-4 rounded-full border-2 border-[var(--color-accent-selected)] border-t-transparent animate-spin" />
            <span className="text-xs text-text-muted">Scanning emails for events...</span>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-4">
            <span className="text-2xl block mb-2">📭</span>
            <p className="text-xs text-text-muted">No new events found in your inbox</p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => {
              const isApproved = approved.has(event.id);
              const config = typeConfig[event.type] || typeConfig.school;

              return (
                <div
                  key={event.id}
                  className="rounded-2xl p-3 transition-all"
                  style={{
                    background: isApproved ? "rgba(74, 222, 128, 0.06)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${isApproved ? "rgba(74, 222, 128, 0.15)" : "rgba(255,255,255,0.06)"}`,
                    opacity: isApproved ? 0.7 : 1,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-9 h-9 rounded-xl grid place-items-center text-base shrink-0"
                      style={{ background: config.color }}
                    >
                      {config.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`text-xs font-bold ${isApproved ? "text-text-muted line-through" : "text-text-primary"}`}>
                        {event.title}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-text-secondary">📅 {event.date}</span>
                        {event.time && <span className="text-[10px] text-text-muted">· 🕐 {event.time}</span>}
                      </div>
                      {event.location && (
                        <p className="text-[10px] text-text-muted mt-0.5">📍 {event.location}</p>
                      )}
                      <p className="text-[9px] text-text-muted mt-0.5">From: {event.source}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isApproved ? (
                        <span className="text-emerald-400 text-xs font-bold">✅ Added</span>
                      ) : (
                        <>
                          <button
                            onClick={() => handleApprove(event.id)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold tap"
                            style={{ background: "rgba(74, 222, 128, 0.15)", color: "#4ade80", border: "1px solid rgba(74, 222, 128, 0.2)" }}
                          >
                            ✅ Add
                          </button>
                          <button
                            onClick={() => handleSkip(event.id)}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold tap text-text-muted hover:text-text-secondary"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                          >
                            Skip
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Surface>
  );
}
