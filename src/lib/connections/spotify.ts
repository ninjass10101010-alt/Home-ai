/**
 * Spotify Integration — Family playlists, bedtime lullabies, playback control.
 *
 * Uses Composio's Spotify toolkit (84 tools) for:
 *   - Playlist management (create, add, search)
 *   - Playback control (play, pause, next, volume)
 *   - Track/album/artist search
 *   - Device management
 *
 * Setup: Enter your Composio API key in Settings → Connections.
 */

import { isConnected, getCredentials } from "./store";

export function isSpotifyEnabled(): boolean {
  return isConnected("spotify");
}

/**
 * Get the Composio API key for Spotify.
 */
export function getSpotifyKey(): string | null {
  const creds = getCredentials("spotify");
  return creds?.apiKey || null;
}

/**
 * Search Spotify tracks via Composio MCP proxy.
 * In production, this would call the Composio API with the user's key.
 */
export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
  const apiKey = getSpotifyKey();
  if (!apiKey) throw new Error("Spotify not connected");

  try {
    const res = await fetch("https://backend.composio.dev/api/v1/tools/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        tool_name: "SPOTIFY_SEARCH_TRACKS",
        params: { query, limit: 10 },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
    const data = await res.json();
    return data.response?.tracks || [];
  } catch (e: any) {
    console.error("Spotify search error:", e);
    return [];
  }
}

/**
 * Create a family playlist.
 */
export async function createPlaylist(name: string, description: string = "Created by Consuela"): Promise<any> {
  const apiKey = getSpotifyKey();
  if (!apiKey) throw new Error("Spotify not connected");

  const res = await fetch("https://backend.composio.dev/api/v1/tools/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      tool_name: "SPOTIFY_CREATE_PLAYLIST",
      params: { name, description },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`Failed to create playlist: ${res.status}`);
  return res.json();
}

/**
 * Pre-defined family playlists for quick creation.
 */
export const FAMILY_PLAYLISTS = [
  { name: "🌅 Morning Wake Up", description: "Energizing songs to start the day", emoji: "🌅" },
  { name: "🚗 Car Ride Jams", description: "Songs for family road trips", emoji: "🚗" },
  { name: "🍽️ Dinner Vibes", description: "Relaxing dinner music", emoji: "🍽️" },
  { name: "🌙 Bedtime Lullabies", description: "Gentle songs for sleepy time", emoji: "🌙" },
  { name: "💃 Dance Party!", description: "Get up and move!", emoji: "💃" },
  { name: "📚 Homework Focus", description: "Instrumental concentration music", emoji: "📚" },
  { name: "🏖️ Weekend Fun", description: "Feel-good weekend playlist", emoji: "🏖️" },
];

export interface SpotifyTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  uri: string;
}
