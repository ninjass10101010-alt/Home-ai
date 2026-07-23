/**
 * SpotifyWidget — Family music player for the dashboard.
 *
 * Shows now-playing, playlist shortcuts, and playback controls.
 * Bedtime mode auto-plays lullabies for kids.
 *
 * Requires: Spotify connected via Settings → Connections.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import Surface from "@/components/ui/Surface";
import IconButton from "@/components/ui/IconButton";
import { isSpotifyEnabled, FAMILY_PLAYLISTS } from "@/lib/connections/spotify";
import { useDashboardMode } from "@/hooks/useDashboardMode";

interface Track {
  name: string;
  artist: string;
  album?: string;
  duration_ms: number;
  image?: string;
}

export default function SpotifyWidget() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(60);
  const [enabled, setEnabled] = useState(false);
  const { isBedtime, mode } = useDashboardMode();

  useEffect(() => {
    setEnabled(isSpotifyEnabled());
  }, []);

  // Simulate playback progress
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= currentTrack.duration_ms) {
          setIsPlaying(false);
          return 0;
        }
        return p + 1000;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, currentTrack]);

  // Bedtime mode → auto-play lullabies
  useEffect(() => {
    if (isBedtime && mode === "kid" && enabled && !currentTrack) {
      selectPlaylist("🌙 Bedtime Lullabies");
    }
  }, [isBedtime, mode, enabled, currentTrack]);

  const selectPlaylist = useCallback((name: string) => {
    // In production, this calls the Spotify API via Composio
    setCurrentTrack({
      name: name.replace(/^[^\s]+\s/, ""), // Remove emoji prefix
      artist: "Family Playlist",
      album: name,
      duration_ms: 180000, // 3 min demo
    });
    setIsPlaying(true);
    setProgress(0);
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  if (!enabled) return null;

  return (
    <Surface variant="glass-subtle" radius="xl" padding="none" className="overflow-hidden">
      {/* Now Playing Header */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl grid place-items-center text-2xl shrink-0"
            style={{
              background: "linear-gradient(135deg, #1db954, #191414)",
              boxShadow: isPlaying ? "0 0 20px rgba(29, 185, 84, 0.3)" : "none",
            }}
          >
            🎵
          </div>
          <div className="flex-1 min-w-0">
            {currentTrack ? (
              <>
                <h3 className="text-sm font-bold text-text-primary truncate">{currentTrack.name}</h3>
                <p className="text-[11px] text-text-secondary truncate">{currentTrack.artist}</p>
              </>
            ) : (
              <>
                <h3 className="text-sm font-bold text-text-primary">Spotify</h3>
                <p className="text-[11px] text-text-secondary">Select a playlist to start</p>
              </>
            )}
          </div>
          <div className="shrink-0 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
            {isPlaying ? "▶ Playing" : "⏸ Paused"}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {currentTrack && (
        <div className="px-4 pb-3">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${(progress / currentTrack.duration_ms) * 100}%`,
                background: "linear-gradient(90deg, #1db954, #1ed760)",
              }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-text-muted tabular-nums">{formatTime(progress)}</span>
            <span className="text-[9px] text-text-muted tabular-nums">{formatTime(currentTrack.duration_ms)}</span>
          </div>
        </div>
      )}

      {/* Playback Controls */}
      {currentTrack && (
        <div className="px-4 pb-3 flex items-center justify-center gap-3">
          <IconButton size="sm" variant="ghost" aria-label="Previous" onClick={() => setProgress(0)}>
            <span className="text-sm">⏮</span>
          </IconButton>
          <button
            onClick={togglePlay}
            className="w-11 h-11 rounded-full grid place-items-center text-white text-lg tap"
            style={{
              background: "linear-gradient(135deg, #1db954, #1ed760)",
              boxShadow: "0 4px 16px rgba(29, 185, 84, 0.3)",
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <IconButton size="sm" variant="ghost" aria-label="Next" onClick={() => setProgress(currentTrack.duration_ms)}>
            <span className="text-sm">⏭</span>
          </IconButton>
          {/* Volume */}
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-xs">🔊</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-14 h-1 accent-emerald-400 cursor-pointer"
              aria-label="Volume"
            />
          </div>
        </div>
      )}

      {/* Playlist Shortcuts */}
      <div className="px-4 pb-4 pt-1 border-t border-white/[0.04]">
        <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Playlists</p>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {FAMILY_PLAYLISTS.map((pl) => (
            <button
              key={pl.name}
              onClick={() => selectPlaylist(pl.name)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap tap shrink-0"
              style={{
                background: currentTrack?.album === pl.name
                  ? "rgba(29, 185, 84, 0.15)"
                  : "rgba(255,255,255,0.05)",
                border: `1px solid ${currentTrack?.album === pl.name ? "rgba(29, 185, 84, 0.3)" : "rgba(255,255,255,0.06)"}`,
                color: currentTrack?.album === pl.name ? "#1ed760" : "var(--color-text-secondary)",
              }}
              title={pl.description}
            >
              <span>{pl.emoji}</span>
              <span>{pl.name.replace(/^[^\s]+\s/, "")}</span>
            </button>
          ))}
        </div>
      </div>
    </Surface>
  );
}
