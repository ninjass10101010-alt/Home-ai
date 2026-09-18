/**
 * ha_alert_state row access with compare-and-set semantics.
 *
 * Both alert crons (weather-alert, calendar-alert) do the same
 * read-modify-write on their ha_alert_state row: load the dedupe/episode
 * state, decide, push, save. PocketBase has no conditional updates, so two
 * overlapping runs can both pass the guard and the second save silently
 * clobbers the first (a lost alerted stamp re-fires an already-pushed
 * episode; lost delivered refs re-push events).
 *
 * Mirrors the consuela_state setState(key, value, expectedPrev) idiom: the
 * loader returns the exact stored value string, and the saver REFUSES the
 * write when the row changed in between (returns false) — the caller's
 * update is stale and the winner's state stands.
 */

export interface PBAlertState {
  collection: (name: string) => {
    getFirstListItem: (filter: string) => Promise<{ id: string; value?: unknown }>;
    create: (data: Record<string, unknown>) => Promise<unknown>;
    update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface LoadedAlertState {
  /** Parsed JSON value of the row ({} when absent/unreadable). */
  value: Record<string, unknown>;
  /** The EXACT stored value string at load time (null when the row is absent)
   * — pass back to saveAlertState as the CAS prev. */
  raw: string | null;
}

export async function loadAlertState(pb: PBAlertState, key: string): Promise<LoadedAlertState> {
  try {
    const row = await pb.collection("ha_alert_state").getFirstListItem(`key="${key}"`);
    const raw = String(row.value ?? "{}");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    return { value: parsed && typeof parsed === "object" ? parsed : {}, raw };
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return { value: {}, raw: null };
    throw err;
  }
}

export async function saveAlertState(
  pb: PBAlertState,
  key: string,
  value: Record<string, unknown>,
  prev: string | null
): Promise<boolean> {
  const collection = pb.collection("ha_alert_state");
  const payload = { key, value: JSON.stringify(value) };
  let existing: { id: string; value?: unknown } | null = null;
  try {
    existing = await collection.getFirstListItem(`key="${key}"`);
  } catch (err) {
    if ((err as { status?: number })?.status !== 404) throw err;
  }
  if (existing) {
    // CAS — the row moved since our load: refuse, never clobber the winner.
    if (prev === null || String(existing.value ?? "{}") !== prev) return false;
    await collection.update(existing.id, payload);
    return true;
  }
  // Row absent. If our load saw a row that has since vanished, treat it as a
  // conflict too; a fresh create (prev === null) is the normal path.
  if (prev !== null) return false;
  await collection.create(payload);
  return true;
}
