/**
 * Spotify Integration — family playlist metadata + enablement flag.
 *
 * The old v1 Composio network calls (`searchTracks`, `createPlaylist`,
 * `getSpotifyKey`) were removed in the v3.1-only cleanup; a `composio.dev/api/v1`
 * call in a live path is a bug. This module keeps the pieces the family UI
 * still consumes: `isSpotifyEnabled` and the `FAMILY_PLAYLISTS` definitions.
 */

import { isConnected } from "./store";

export function isSpotifyEnabled(): boolean {
  return isConnected("spotify");
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
