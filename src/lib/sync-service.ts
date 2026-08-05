const API_BASE = "http://100.120.64.66:6789";

export async function syncPush(type: any, data: any) {
  try {
    const res = await fetch(API_BASE + "/data/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
    return (await res.json()).success === true;
  } catch { return false; }
}

export async function syncPull(type: any): Promise<any[]> {
  try {
    const res = await fetch(API_BASE + "/data/sync?type=" + type);
    const result = await res.json();
    return result.success ? (result.data || []) : [];
  } catch { return []; }
}

export function mergeAndSync(type: any, storageKey: any) {
  syncPull(type).then((remote: any[]) => {
    if (!remote.length) return;
    try {
      const stored = localStorage.getItem(storageKey);
      const local: any[] = stored ? JSON.parse(stored) : [];
      const merged = new Map<number, any>();
      for (const item of local) merged.set(item.id, item);
      for (const item of remote) merged.set(item.id, item);
      localStorage.setItem(storageKey, JSON.stringify(Array.from(merged.values())));
    } catch {}
  });
}

export function pushLocal(type: any, storageKey: any) {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) syncPush(type, JSON.parse(stored));
  } catch {}
}
