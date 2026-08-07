/**
 * Google Maps Integration — Travel times, directions, location search.
 *
 * Uses Composio's Google Maps Search + Flight/Hotel search for:
 *   - Travel time calculation from home to event location
 *   - "Leave by" reminders
 *   - Restaurant/activity search near events
 *   - Flight and hotel search for family trips
 *
 * Setup: Enter your Composio API key + home address in Settings → Connections.
 */

import { isConnected, getCredentials } from "./store";

export function isMapsEnabled(): boolean {
  return isConnected("google_maps");
}

export function getMapsCredentials(): { apiKey: string; homeAddress: string } | null {
  const creds = getCredentials("google_maps");
  if (!creds?.apiKey) return null;
  return {
    apiKey: creds.apiKey,
    homeAddress: creds.homeAddress || "",
  };
}

/**
 * Get travel time from home to a destination.
 */
export async function getTravelTime(destination: string): Promise<TravelTimeResult | null> {
  const creds = getMapsCredentials();
  if (!creds || !creds.homeAddress) return null;

  try {
    const res = await fetch("https://backend.composio.dev/api/v1/tools/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": creds.apiKey,
      },
      body: JSON.stringify({
        tool_name: "COMPOSIO_SEARCH_GOOGLE_MAPS",
        params: {
          query: `directions from ${creds.homeAddress} to ${destination}`,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // Parse the response for travel time
    return {
      duration: data.response?.duration || "Unknown",
      distance: data.response?.distance || "Unknown",
      destination,
      homeAddress: creds.homeAddress,
    };
  } catch (e) {
    console.error("Maps travel time error:", e);
    return null;
  }
}

/**
 * Search for restaurants, activities, or services near a location.
 */
export async function searchNearby(query: string, near: string): Promise<MapResult[]> {
  const creds = getMapsCredentials();
  if (!creds) return [];

  try {
    const res = await fetch("https://backend.composio.dev/api/v1/tools/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": creds.apiKey,
      },
      body: JSON.stringify({
        tool_name: "COMPOSIO_SEARCH_GOOGLE_MAPS",
        params: {
          query: `${query} near ${near}`,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.response?.results || [];
  } catch (e) {
    console.error("Maps search error:", e);
    return [];
  }
}

/**
 * Calculate when to leave to arrive on time.
 */
export function calculateLeaveBy(arrivalTime: string, travelDuration: string): string {
  // Parse travel duration (e.g., "12 mins", "1 hr 15 mins")
  let minutes = 0;
  const hourMatch = travelDuration.match(/(\d+)\s*(?:hr|hour)/i);
  const minMatch = travelDuration.match(/(\d+)\s*min/i);
  if (hourMatch) minutes += parseInt(hourMatch[1]) * 60;
  if (minMatch) minutes += parseInt(minMatch[1]);
  if (minutes === 0) minutes = 15; // default fallback

  // Add 5-minute buffer
  minutes += 5;

  // Parse arrival time
  const arrival = new Date();
  const timeMatch = arrivalTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const mins = parseInt(timeMatch[2]);
    const period = timeMatch[3]?.toUpperCase();
    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    arrival.setHours(hours, mins, 0);
  }

  // Subtract travel time
  arrival.setMinutes(arrival.getMinutes() - minutes);

  return arrival.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export interface TravelTimeResult {
  duration: string;
  distance: string;
  destination: string;
  homeAddress: string;
}

export interface MapResult {
  name: string;
  address?: string;
  rating?: number;
  types?: string[];
}
