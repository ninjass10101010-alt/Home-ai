import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalMemberFallbacksEnabled,
  mergeMemberFallbacks,
} from "@/lib/member-fallback";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical member fallback gate", () => {
  it("forces production off even when opt-in is true", () => {
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
});
