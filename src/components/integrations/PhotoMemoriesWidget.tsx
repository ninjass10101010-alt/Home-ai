/**
 * PhotoMemoriesWidget — Family memories from Google Photos.
 *
 * Shows:
 *   - "This Day Last Year" photo memories
 *   - Recent family photos grid
 *   - Auto-created albums from events
 *
 * Requires: Google Photos connected via Settings → Connections.
 */
"use client";

import { useState, useEffect } from "react";
import Surface from "@/components/ui/Surface";
import { isConnected } from "@/lib/connections/store";

interface PhotoMemory {
  id: string;
  title: string;
  date: string;
  year: number;
  thumbnail: string;
  photoCount: number;
}

const MOCK_MEMORIES: PhotoMemory[] = [
  {
    id: "mem-1",
    title: "Beach Day at Grand Haven",
    date: "Jul 18, 2025",
    year: 2025,
    thumbnail: "🏖️",
    photoCount: 47,
  },
  {
    id: "mem-2",
    title: "Caspian's 8th Birthday",
    date: "Jul 18, 2024",
    year: 2024,
    thumbnail: "🎂",
    photoCount: 83,
  },
  {
    id: "mem-3",
    title: "Camping at Ludington",
    date: "Jul 18, 2023",
    year: 2023,
    thumbnail: "⛺",
    photoCount: 62,
  },
];

const RECENT_ALBUMS = [
  { name: "Soccer Season 2026", emoji: "⚽", count: 156 },
  { name: "Summer Vacation", emoji: "☀️", count: 234 },
  { name: "School Play", emoji: "🎭", count: 42 },
  { name: "Family Dinner", emoji: "🍽️", count: 18 },
];

export default function PhotoMemoriesWidget() {
  const [enabled, setEnabled] = useState(false);
  const [memories, setMemories] = useState<PhotoMemory[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(isConnected("google_photos"));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // In production, this queries Google Photos API via Composio
    setMemories(MOCK_MEMORIES);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <Surface variant="warm" radius="2xl" padding="none">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">📸</span>
            <h3 className="text-sm font-bold text-text-primary">Memories</h3>
          </div>
          <span className="text-[10px] font-semibold text-text-muted">This Day</span>
        </div>

        {/* "This Day" Memories — horizontal scroll */}
        {memories.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
              On this day in past years
            </p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {memories.map((memory) => (
                <button
                  key={memory.id}
                  onClick={() => setSelectedMemory(
                    selectedMemory === memory.id ? null : memory.id
                  )}
                  className="shrink-0 w-36 rounded-xl overflow-hidden tap text-left"
                  style={{
                    border: `2px solid ${selectedMemory === memory.id ? "var(--color-accent-selected)" : "rgba(255,255,255,0.06)"}`,
                    background: selectedMemory === memory.id
                      ? "rgba(var(--color-accent-selected-rgb, 59,130,246), 0.08)"
                      : "rgba(255,255,255,0.03)",
                  }}
                >
                  {/* Photo placeholder */}
                  <div
                    className="h-20 grid place-items-center text-4xl"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                    }}
                  >
                    {memory.thumbnail}
                  </div>
                  <div className="p-2">
                    <h4 className="text-[11px] font-bold text-text-primary truncate">{memory.title}</h4>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[9px] text-text-muted">{memory.year} · {memory.date}</span>
                      <span className="text-[9px] text-text-muted">{memory.photoCount} 📷</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent Albums */}
        <div>
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
            Recent Albums
          </p>
          <div className="grid grid-cols-2 gap-2">
            {RECENT_ALBUMS.map((album) => (
              <a
                key={album.name}
                href="https://photos.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 p-2.5 rounded-xl tap"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <span className="text-xl">{album.emoji}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[11px] font-semibold text-text-primary truncate">{album.name}</h4>
                  <span className="text-[9px] text-text-muted">{album.count} photos</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </Surface>
  );
}
