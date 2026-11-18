import { haSynthesize } from "./ha/voice";

export interface BroadcastItem {
  id: string;
  message: string;
  title: string;
  sender: string;
  audioUrl?: string;
  createdAt: string;
}

// In-memory circular buffer of recent broadcasts (max 30 items)
const broadcastHistory: BroadcastItem[] = [];
const MAX_HISTORY = 30;

type BroadcastResolver = (items: BroadcastItem[]) => void;
const waitingResolvers = new Set<BroadcastResolver>();

export function getRecentBroadcasts(sinceId?: string): BroadcastItem[] {
  if (!sinceId || sinceId === "now" || sinceId === "latest") {
    return [];
  }
  const idx = broadcastHistory.findIndex((b) => b.id === sinceId);
  if (idx === -1) {
    // If sinceId is not found, return empty to avoid replaying ancient history
    return [];
  }
  return broadcastHistory.slice(idx + 1);
}

export function getLatestBroadcastId(): string | null {
  if (broadcastHistory.length === 0) return null;
  return broadcastHistory[broadcastHistory.length - 1].id;
}

export async function publishBroadcast(
  message: string,
  options?: { title?: string; sender?: string }
): Promise<BroadcastItem> {
  const cleanMessage = (message || "").trim();
  if (!cleanMessage) {
    throw new Error("Cannot broadcast empty message");
  }

  let audioUrl = "";
  try {
    const syn = await haSynthesize(cleanMessage);
    audioUrl = syn.url;
  } catch (err) {
    console.warn("[broadcast] haSynthesize warning:", err);
  }

  const broadcast: BroadcastItem = {
    id: `bc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message: cleanMessage,
    title: options?.title?.trim() || "Family Announcement 📢",
    sender: options?.sender?.trim() || "Consuela",
    audioUrl,
    createdAt: new Date().toISOString(),
  };

  broadcastHistory.push(broadcast);
  if (broadcastHistory.length > MAX_HISTORY) {
    broadcastHistory.shift();
  }

  // Wake up any long-polling clients
  for (const resolver of Array.from(waitingResolvers)) {
    try {
      resolver([broadcast]);
    } catch {
      // ignore client resolver errors
    }
  }
  waitingResolvers.clear();

  return broadcast;
}

export function waitForBroadcast(
  sinceId?: string,
  timeoutMs = 25000
): Promise<BroadcastItem[]> {
  const pending = getRecentBroadcasts(sinceId);
  if (pending.length > 0) {
    return Promise.resolve(pending);
  }

  return new Promise<BroadcastItem[]>((resolve) => {
    let timer: NodeJS.Timeout | null = null;

    const resolver: BroadcastResolver = (items) => {
      if (timer) clearTimeout(timer);
      waitingResolvers.delete(resolver);
      resolve(items);
    };

    timer = setTimeout(() => {
      waitingResolvers.delete(resolver);
      resolve([]);
    }, timeoutMs);

    waitingResolvers.add(resolver);
  });
}

/** Test-only: reset module state between tests */
export function resetBroadcastForTests() {
  broadcastHistory.length = 0;
  waitingResolvers.clear();
}
