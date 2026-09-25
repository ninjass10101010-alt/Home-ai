import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS,
  canonicalMemberFallbacksEnabled,
  mergeMemberFallbacks,
} from "@/lib/member-fallback";

const OPT_IN = NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical member fallback gate", () => {
  it("forces production off even when opt-in is true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(OPT_IN, "true");

    expect(
      canonicalMemberFallbacksEnabled({
        nodeEnv: "production",
        optIn: "true",
      }),
    ).toBe(false);

    const live = [{ id: "live", name: "Parent One" }];
    expect(mergeMemberFallbacks(live)).toEqual(live);
  });

  it("requires explicit opt-in outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(OPT_IN, undefined);

    expect(
      canonicalMemberFallbacksEnabled({
        nodeEnv: "development",
        optIn: undefined,
      }),
    ).toBe(false);
    expect(
      canonicalMemberFallbacksEnabled({
        nodeEnv: "test",
        optIn: "true",
      }),
    ).toBe(true);
  });

  it("reads process.env when no explicit input is given", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(OPT_IN, "true");
    expect(canonicalMemberFallbacksEnabled()).toBe(false);

    vi.stubEnv("NODE_ENV", "test");
    expect(canonicalMemberFallbacksEnabled()).toBe(true);

    vi.stubEnv(OPT_IN, undefined);
    expect(canonicalMemberFallbacksEnabled()).toBe(false);
  });

  it("merges the canonical family only for a non-production opt-in", () => {
    const live = [{ id: "live", name: "Parent One" }];

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(OPT_IN, undefined);
    expect(mergeMemberFallbacks(live)).toEqual(live);

    vi.stubEnv(OPT_IN, "true");
    expect(mergeMemberFallbacks(live)).toHaveLength(10);

    vi.stubEnv("NODE_ENV", "production");
    expect(mergeMemberFallbacks(live)).toEqual(live);
  });

  it("drops rows with no name from the PocketBase roster", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(OPT_IN, "true");

    expect(
      mergeMemberFallbacks([
        { id: "m8", name: "   ", role: "child" },
        { id: "m9", name: "Caspian Garcia", role: "child" },
        { id: "m10", role: "child" },
      ]),
    ).toEqual([{ id: "m9", name: "Caspian Garcia", role: "child" }]);
  });
});
