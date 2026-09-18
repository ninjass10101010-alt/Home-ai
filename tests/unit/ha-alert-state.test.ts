import { describe, it, expect, vi } from "vitest";
import { loadAlertState, saveAlertState } from "@/lib/ha/alert-state";

/** Mirrors the ha_alert_state pb surface the routes touch. */
function makeStatePb() {
  const rows = new Map<string, { id: string; key: string; value: string }>();
  return {
    rows,
    pb: {
      collection: () => ({
        getFirstListItem: async (filter: string) => {
          const m = /key="([^"]+)"/.exec(filter);
          const hit = m ? rows.get(m[1]) : undefined;
          if (!hit) throw { status: 404 };
          return { ...hit };
        },
        create: async (d: { key: string; value: string }) => {
          const row = { id: `id-${d.key}`, ...d };
          rows.set(d.key, row);
          return row;
        },
        update: async (id: string, d: { key: string; value: string }) => {
          const row = [...rows.values()].find((r) => r.id === id);
          if (!row) throw { status: 404 };
          rows.set(row.key, { ...row, ...d });
          return rows.get(row.key)!;
        },
      }),
    },
  };
}

const KEY = "weather-alert";

describe("ha_alert_state CAS (loadAlertState / saveAlertState)", () => {
  it("loads a missing row as null raw + empty object value", async () => {
    const { pb } = makeStatePb();
    const loaded = await loadAlertState(pb as any, KEY);
    expect(loaded.raw).toBeNull();
    expect(loaded.value).toEqual({});
  });

  it("round-trips: save with the loaded prev overwrites; reload sees new value", async () => {
    const { pb, rows } = makeStatePb();
    const first = await loadAlertState(pb as any, KEY);
    expect(await saveAlertState(pb as any, KEY, { active: true }, first.raw)).toBe(true);
    const second = await loadAlertState(pb as any, KEY);
    expect(second.value).toEqual({ active: true });
    expect(await saveAlertState(pb as any, KEY, { active: false }, second.raw)).toBe(true);
    expect(JSON.parse(rows.get(KEY)!.value)).toEqual({ active: false });
  });

  it("REFUSES the write when the stored value changed since prev (lost-update guard)", async () => {
    const { pb, rows } = makeStatePb();
    const stale = await loadAlertState(pb as any, KEY);
    // Another writer lands between our load and our save.
    await saveAlertState(pb as any, KEY, { active: true, winner: true }, stale.raw);
    // Our save still holds the ORIGINAL prev — must refuse, not clobber.
    expect(await saveAlertState(pb as any, KEY, { active: true, loser: true }, stale.raw)).toBe(false);
    expect(JSON.parse(rows.get(KEY)!.value)).toEqual({ active: true, winner: true });
  });

  it("REFUSES when the row appeared after a load that saw none (create race)", async () => {
    const { pb, rows } = makeStatePb();
    const loaded = await loadAlertState(pb as any, KEY); // no row yet
    await saveAlertState(pb as any, KEY, { first: 1 }, null); // concurrent creator
    expect(await saveAlertState(pb as any, KEY, { second: 2 }, loaded.raw)).toBe(false);
    expect(JSON.parse(rows.get(KEY)!.value)).toEqual({ first: 1 });
  });
});
