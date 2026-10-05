// The family timezone is a DEPLOYMENT input, not a runtime guess.
//
// `deploy.sh` runs `docker compose up -d --build consuela-dashboard` from the
// PARENT repo directory, so the compose file that actually builds production is
// the parent's — and for a long time it set no `TZ` at all. With `TZ` unset in a
// `node:*-alpine` image (no `/etc/localtime`), `Intl` resolves to UTC, and the
// whole time system — localTodayISO, week starts, the weekly points reset,
// recurring-task regrouping, archive enshrinement, deadline culls — moved four
// hours early. `vitest.config.ts` pins `TZ=America/Detroit`, which is exactly why
// 5846 green tests could not see it.
//
// So these cases RE-PIN the zone per test with `vi.stubEnv` + `vi.resetModules()`
// + a fresh dynamic import. Nothing here reads the ambient TZ: the module
// resolves and validates the family zone once, and every case must be able to
// hand it a different one.
//
// The second bug this file pins is the SILENT one. `TZ=America/Detriot` (one
// typo) used to sail straight through: `familyTimeZone()` returned the bad
// string, `Intl.DateTimeFormat().resolvedOptions().timeZone` quietly answered
// `undefined`, and every time-dependent route then died on a bare `RangeError`
// with nothing naming the key that was wrong. An unusable zone must be a named,
// actionable failure instead.

import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type LocalDateModule = typeof import("@/lib/local-date");

/**
 * Pin `process.env.TZ`, drop the module registry, and import a fresh copy of
 * `@/lib/local-date` so the family zone is resolved against THAT value.
 * `null` means "unset the variable entirely" (the container's real state).
 */
async function withTimeZone(tz: string | null): Promise<LocalDateModule> {
  vi.resetModules();
  vi.stubEnv("TZ", tz === null ? undefined : tz);
  return (await import("@/lib/local-date")) as LocalDateModule;
}

function errorFrom(run: () => unknown): Error {
  try {
    run();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to throw, but it returned");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// 2026-09-27 is a Sunday; the week's Monday is 2026-09-21. America/Detroit is
// UTC-4 (EDT) through late September, so these instants are exact.
const SUNDAY_ET = {
  at18: "2026-09-27T22:00:00.000Z", // Sun 18:00 ET
  at20: "2026-09-28T00:00:00.000Z", // Sun 20:00 ET — already tomorrow in UTC
  at2359: "2026-09-28T03:59:00.000Z", // Sun 23:59 ET — 3:59 "tomorrow" in UTC
  mon0001: "2026-09-28T04:01:00.000Z", // Mon 00:01 ET — the real rollover
} as const;

describe("family timezone — the resolved zone is the family zone", () => {
  it("uses TZ=America/Detroit everywhere a caller reads the zone", async () => {
    const m = await withTimeZone("America/Detroit");
    expect(m.familyTimeZone()).toBe("America/Detroit");

    const now = new Date(SUNDAY_ET.mon0001);
    const ctx = m.localDateContext(now);
    expect(ctx.tz).toBe("America/Detroit");
    expect(ctx.todayISO).toBe("2026-09-28");
    expect(ctx.todayWeekday).toBe("Mon");
    expect(ctx.weekStartISO).toBe("2026-09-28");
  });

  it("keeps a valid UTC-AHEAD and UTC-BEHIND zone verbatim", async () => {
    const ahead = await withTimeZone("Australia/Sydney");
    expect(ahead.familyTimeZone()).toBe("Australia/Sydney");
    expect(ahead.localTodayISO(new Date(SUNDAY_ET.at18))).toBe("2026-09-28");

    const behind = await withTimeZone("America/Bogota");
    expect(behind.familyTimeZone()).toBe("America/Bogota");
    expect(behind.localTodayISO(new Date(SUNDAY_ET.mon0001))).toBe("2026-09-27");
  });
});

describe("family timezone — the Sunday/Monday week boundary", () => {
  // THE REGRESSION. Under UTC the week rolls at 20:00 ET on Sunday — four hours
  // early — so Sunday evening's completions land in the new week,
  // `resetRecurringTasksForWeek` regroups Sunday-due chores into it, and
  // `ensureArchivedWeeksEnshrined` freezes the old podium without them.
  it("holds Sunday ET in the PREVIOUS Monday's week and rolls only at Monday 00:01 ET", async () => {
    const m = await withTimeZone("America/Detroit");

    expect(m.localTodayISO(new Date(SUNDAY_ET.at18))).toBe("2026-09-27");
    expect(m.localWeekStartISO(new Date(SUNDAY_ET.at18))).toBe("2026-09-21");

    expect(m.localTodayISO(new Date(SUNDAY_ET.at20))).toBe("2026-09-27");
    expect(m.localWeekStartISO(new Date(SUNDAY_ET.at20))).toBe("2026-09-21");

    expect(m.localTodayISO(new Date(SUNDAY_ET.at2359))).toBe("2026-09-27");
    expect(m.localWeekStartISO(new Date(SUNDAY_ET.at2359))).toBe("2026-09-21");

    expect(m.localTodayISO(new Date(SUNDAY_ET.mon0001))).toBe("2026-09-28");
    expect(m.localWeekStartISO(new Date(SUNDAY_ET.mon0001))).toBe("2026-09-28");
  });

  it("pins the exact four-hour-early rollover the UTC axis produced", async () => {
    // Kept deliberately: this is what production did, and the pair of cases must
    // disagree — if UTC and Detroit ever agree here, the zone is not being read.
    const utc = await withTimeZone("UTC");
    expect(utc.localTodayISO(new Date(SUNDAY_ET.at18))).toBe("2026-09-27");
    expect(utc.localWeekStartISO(new Date(SUNDAY_ET.at18))).toBe("2026-09-21");

    expect(utc.localTodayISO(new Date(SUNDAY_ET.at20))).toBe("2026-09-28");
    expect(utc.localWeekStartISO(new Date(SUNDAY_ET.at20))).toBe("2026-09-28");

    expect(utc.localTodayISO(new Date(SUNDAY_ET.at2359))).toBe("2026-09-28");
    expect(utc.localWeekStartISO(new Date(SUNDAY_ET.at2359))).toBe("2026-09-28");

    expect(utc.localTodayISO(new Date(SUNDAY_ET.mon0001))).toBe("2026-09-28");
    expect(utc.localWeekStartISO(new Date(SUNDAY_ET.mon0001))).toBe("2026-09-28");
  });

  it("maps Monday 00:00 and Monday 23:59 ET to one week, and Sunday to the previous Monday", async () => {
    const m = await withTimeZone("America/Detroit");

    // Monday 2026-09-28, the first second and the last second of the day.
    expect(m.localWeekStartISO(new Date("2026-09-28T04:00:00.000Z"))).toBe("2026-09-28");
    expect(m.localWeekStartISO(new Date("2026-09-29T03:59:00.000Z"))).toBe("2026-09-28");
    expect(m.localTodayISO(new Date("2026-09-29T03:59:00.000Z"))).toBe("2026-09-28");

    // Sunday of that same week belongs to the Monday that opened it, and the
    // Sunday of the NEXT week belongs to the next Monday — never to itself.
    expect(m.localWeekStartISO(new Date("2026-09-27T16:00:00.000Z"))).toBe("2026-09-21");
    expect(m.localWeekStartISO(new Date("2026-10-04T16:00:00.000Z"))).toBe("2026-09-28");

    expect(m.weekdayOfISO("2026-09-27")).toBe("Sun");
    expect(m.weekdayOfISO("2026-09-28")).toBe("Mon");
    expect(m.localWeekdayShort(new Date(SUNDAY_ET.at2359))).toBe("Sun");
    expect(m.localWeekdayShort(new Date(SUNDAY_ET.mon0001))).toBe("Mon");
  });

  it("reads a completion instant on the family axis, not the UTC one", async () => {
    const m = await withTimeZone("America/Detroit");
    // A chore finished Sun 20:30 ET. `.slice(0, 10)` of this instant says
    // "2026-09-28" — tomorrow — which drops it out of `day <= today`.
    expect(m.localDateOf("2026-09-28T00:30:00.000Z")).toBe("2026-09-27");
    expect(m.localDateOfStoredDate("2026-09-28T00:30:00.000Z")).toBe("2026-09-27");
    expect(m.localDateOfStoredDate("2026-09-27")).toBe("2026-09-27");
    expect(m.localDateOfStoredDate("Today")).toBeNull();
  });
});

describe("family timezone — an unusable TZ fails loudly", () => {
  it.each(["Not/AZone", "America/Detriot"])(
    "refuses %s with a named error that says which key to set",
    async (bad) => {
      const m = await withTimeZone(bad);

      const err = errorFrom(() => m.familyTimeZone());
      expect(err.name).toBe("InvalidFamilyTimeZoneError");
      expect(err.message).toContain("invalid_family_timezone");
      expect(err.message).toContain("TZ");
      expect(err.message).toContain("America/Detroit");
      // The bad value is quoted back so the operator can see WHICH typo.
      expect(err.message).toContain(bad);
      // Not a bare Intl RangeError with no diagnostic.
      expect(err).not.toBeInstanceOf(RangeError);

      // Every caller reads the validated zone, so every caller fails the same
      // way instead of 500ing on an anonymous Intl RangeError.
      for (const call of [
        () => m.localTodayISO(new Date(SUNDAY_ET.at20)),
        () => m.localWeekStartISO(new Date(SUNDAY_ET.at20)),
        () => m.localDateOf("2026-09-28T00:30:00.000Z"),
        () => m.localPreviousDayISO("2026-09-27"),
        () => m.weekdayOfISO("2026-09-27"),
        () => m.localWeekdayShort(new Date(SUNDAY_ET.at20)),
        () => m.localDateContext(new Date(SUNDAY_ET.at20)),
      ]) {
        expect(errorFrom(call).message).toContain("invalid_family_timezone");
      }
    },
  );

  it("an EMPTY TZ falls back to the resolved system zone instead of throwing", async () => {
    const m = await withTimeZone("");
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(resolved).toBeTruthy();

    // Never the empty string itself — that would make Intl throw RangeError on
    // every call, which is the silent degradation being removed.
    expect(() => m.familyTimeZone()).not.toThrow();
    expect(m.familyTimeZone()).not.toBe("");
    // ICU answers the sentinel `Etc/Unknown` when it cannot name a zone, and
    // Intl rejects that sentinel — in exactly that state the runtime's own local
    // calendar IS UTC, so UTC is the honest value of "the resolved system zone".
    expect(m.familyTimeZone()).toBe(resolved === "Etc/Unknown" ? "UTC" : resolved);

    expect(m.localTodayISO(new Date(SUNDAY_ET.mon0001))).toBe("2026-09-28");
    expect(m.localWeekStartISO(new Date(SUNDAY_ET.mon0001))).toBe("2026-09-28");
  });

  it("a WHITESPACE-ONLY TZ is the same as an empty one, and an unset one still resolves", async () => {
    const blank = await withTimeZone("   ");
    expect(() => blank.familyTimeZone()).not.toThrow();
    expect(blank.familyTimeZone()).not.toBe("   ");

    const unset = await withTimeZone(null);
    expect(() => unset.familyTimeZone()).not.toThrow();
    expect(unset.familyTimeZone()).toBeTruthy();
  });
});

describe("family timezone — month, year and DST carry", () => {
  it("carries a month boundary", async () => {
    const m = await withTimeZone("America/Detroit");

    expect(m.localTodayISO(new Date("2026-09-27T23:59:00.000Z"))).toBe("2026-09-27");
    // 00:01 ET the next day is already October? No — 2026-09-28; the boundary
    // that matters is the one into the NEXT Monday.
    expect(m.localTodayISO(new Date("2026-09-28T04:01:00.000Z"))).toBe("2026-09-28");

    // Sunday 2026-10-04 still belongs to the September Monday...
    expect(m.localTodayISO(new Date("2026-10-04T16:00:00.000Z"))).toBe("2026-10-04");
    expect(m.localWeekStartISO(new Date("2026-10-04T16:00:00.000Z"))).toBe("2026-09-28");
    // ...and Monday 2026-10-05 opens October's own week.
    expect(m.localWeekStartISO(new Date("2026-10-05T16:00:00.000Z"))).toBe("2026-10-05");
  });

  it("carries a year boundary without splitting the week that straddles it", async () => {
    const m = await withTimeZone("America/Detroit");
    // 2025-12-31 is a Wednesday, 2026-01-01 a Thursday: one Mon-Sun week.
    expect(m.localTodayISO(new Date("2025-12-31T17:00:00.000Z"))).toBe("2025-12-31");
    expect(m.localTodayISO(new Date("2026-01-01T17:00:00.000Z"))).toBe("2026-01-01");
    expect(m.localWeekStartISO(new Date("2025-12-31T17:00:00.000Z"))).toBe("2025-12-29");
    expect(m.localWeekStartISO(new Date("2026-01-01T17:00:00.000Z"))).toBe("2025-12-29");
    // Sunday 2026-01-04 closes that same 2025 week; Monday 2026-01-05 opens 2026.
    expect(m.localWeekStartISO(new Date("2026-01-04T17:00:00.000Z"))).toBe("2025-12-29");
    expect(m.localWeekStartISO(new Date("2026-01-05T17:00:00.000Z"))).toBe("2026-01-05");
    expect(m.localPreviousDayISO("2026-01-01")).toBe("2025-12-31");
  });

  it("a DST spring-forward day (23 hours) still moves exactly one calendar day", async () => {
    const m = await withTimeZone("America/Detroit");
    // 2026-03-08: 02:00 EST jumps to 03:00 EDT, so the local day is 23 hours.
    // Measured between the two LOCAL noons, which are different UTC instants:
    // Sat noon is 17:00Z (EST), Sun noon is 16:00Z (EDT).
    const day = 24 * 60 * 60 * 1000;
    expect(
      new Date("2026-03-08T16:00:00.000Z").getTime() -
        new Date("2026-03-07T17:00:00.000Z").getTime(),
    ).toBe(day - 60 * 60 * 1000);

    expect(m.localTodayISO(new Date("2026-03-07T23:00:00.000Z"))).toBe("2026-03-07"); // Sat 18:00 EST
    expect(m.localTodayISO(new Date("2026-03-08T05:30:00.000Z"))).toBe("2026-03-08"); // Sun 00:30 EST
    expect(m.localTodayISO(new Date("2026-03-08T16:00:00.000Z"))).toBe("2026-03-08"); // Sun 12:00 EDT
    expect(m.localTodayISO(new Date("2026-03-09T16:00:00.000Z"))).toBe("2026-03-09"); // Mon 12:00 EDT

    expect(m.localWeekStartISO(new Date("2026-03-08T16:00:00.000Z"))).toBe("2026-03-02");
    expect(m.localWeekStartISO(new Date("2026-03-09T16:00:00.000Z"))).toBe("2026-03-09");
    expect(m.localPreviousDayISO("2026-03-08")).toBe("2026-03-07");
    expect(m.localPreviousDayISO("2026-03-09")).toBe("2026-03-08");
  });

  it("a DST fall-back day (25 hours) still moves exactly one calendar day", async () => {
    const m = await withTimeZone("America/Detroit");
    // 2026-11-01: 02:00 EDT falls back to 01:00 EST, so the local day is 25 hours.
    // Local noons again: Sun noon is 16:00Z (EDT), Mon noon is 17:00Z (EST).
    const day = 24 * 60 * 60 * 1000;
    expect(
      new Date("2026-11-02T17:00:00.000Z").getTime() -
        new Date("2026-11-01T16:00:00.000Z").getTime(),
    ).toBe(day + 60 * 60 * 1000);

    expect(m.localTodayISO(new Date("2026-11-01T04:30:00.000Z"))).toBe("2026-11-01"); // Sun 00:30 EDT
    expect(m.localTodayISO(new Date("2026-11-01T16:00:00.000Z"))).toBe("2026-11-01"); // Sun 12:00 EDT
    expect(m.localTodayISO(new Date("2026-11-02T17:00:00.000Z"))).toBe("2026-11-02"); // Mon 12:00 EST

    expect(m.localWeekStartISO(new Date("2026-11-01T16:00:00.000Z"))).toBe("2026-10-26");
    expect(m.localWeekStartISO(new Date("2026-11-02T17:00:00.000Z"))).toBe("2026-11-02");
    expect(m.localPreviousDayISO("2026-11-02")).toBe("2026-11-01");
  });
});

// The bug lived in the DEPLOY definition, not in a test-visible default: the
// compose file `deploy.sh` actually runs is the PARENT repo's, and it carried no
// `TZ` at all, so no amount of correct TypeScript could reach the family zone.
const PARENT_COMPOSE = resolve(__dirname, "../../../docker-compose.yml");

describe("family timezone — the deploy definition carries TZ", () => {
  it.skipIf(!existsSync(PARENT_COMPOSE))(
    "home-dashboard.environment sets TZ with an America/Detroit default",
    () => {
      const compose = readFileSync(PARENT_COMPOSE, "utf8");
      const service = compose.slice(
        compose.indexOf("\n  home-dashboard:"),
        compose.indexOf("\n  daily-budget:"),
      );
      expect(service.length).toBeGreaterThan(0);
      // `Home-ai/docker-compose.yml` already had this; the deployed one did not.
      expect(service).toContain("- TZ=${TZ:-America/Detroit}");
    },
  );
});
