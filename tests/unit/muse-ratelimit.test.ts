import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkKeyLimit,
  checkLoginLimit,
  registerLoginFailure,
  clearLoginFailures,
  isLoginLocked,
  __resetMuseLimits,
} from "@/lib/muse/ratelimit";

beforeEach(() => __resetMuseLimits());
afterEach(() => vi.useRealTimers());

// capacity = rate + burst headroom (perMin/4, min 5)
const keyCapacity = (rate: number) => rate + Math.max(5, Math.floor(rate / 4));

describe("checkKeyLimit — token bucket per key prefix", () => {
  it("allows a full burst up to capacity then refuses", () => {
    const rate = 10;
    const cap = keyCapacity(rate);
    for (let i = 0; i < cap; i++) expect(checkKeyLimit("abc123", rate)).toBe(true);
    expect(checkKeyLimit("abc123", rate)).toBe(false);
  });

  it("keeps separate buckets per key prefix", () => {
    const rate = 10;
    const cap = keyCapacity(rate);
    for (let i = 0; i < cap; i++) checkKeyLimit("k1", rate);
    expect(checkKeyLimit("k1", rate)).toBe(false);
    expect(checkKeyLimit("k2", rate)).toBe(true);
  });

  it("defaults to 120/min when perMin is falsy", () => {
    const cap = keyCapacity(120); // 120 + 30
    for (let i = 0; i < cap; i++) expect(checkKeyLimit("dflt", 0)).toBe(true);
    expect(checkKeyLimit("dflt", 0)).toBe(false);
  });

  it("refills at perMin/60 per second", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(t0);
    const rate = 60; // 1 token/sec
    const cap = keyCapacity(rate);
    for (let i = 0; i < cap; i++) checkKeyLimit("refill", rate);
    expect(checkKeyLimit("refill", rate)).toBe(false);
    vi.setSystemTime(new Date(t0.getTime() + 2000)); // +2 tokens
    expect(checkKeyLimit("refill", rate)).toBe(true);
    expect(checkKeyLimit("refill", rate)).toBe(true);
    expect(checkKeyLimit("refill", rate)).toBe(false);
  });

  it("reset seam clears every bucket", () => {
    for (let i = 0; i < keyCapacity(10); i++) checkKeyLimit("seam", 10);
    expect(checkKeyLimit("seam", 10)).toBe(false);
    __resetMuseLimits();
    expect(checkKeyLimit("seam", 10)).toBe(true);
  });
});

describe("checkLoginLimit — 5 attempts/min per IP", () => {
  it("allows exactly 5 rapid attempts then refuses the 6th", () => {
    const ip = "1.2.3.4";
    for (let i = 0; i < 5; i++) expect(checkLoginLimit(ip)).toBe(true);
    expect(checkLoginLimit(ip)).toBe(false);
  });

  it("is per IP", () => {
    for (let i = 0; i < 5; i++) checkLoginLimit("a");
    expect(checkLoginLimit("a")).toBe(false);
    expect(checkLoginLimit("b")).toBe(true);
  });
});

describe("bounded memory under forged-key churn", () => {
  it("evicts the oldest key bucket once the map exceeds the cap", () => {
    const rate = 10;
    const cap = keyCapacity(rate);
    for (let i = 0; i < cap; i++) checkKeyLimit("oldest", rate);
    expect(checkKeyLimit("oldest", rate)).toBe(false);
    // Push the map past its 10_000-entry cap with fresh forged prefixes.
    for (let i = 0; i < 10_000; i++) checkKeyLimit(`churn-${i}`, rate);
    // The oldest bucket was evicted, so it starts fresh with a full burst.
    expect(checkKeyLimit("oldest", rate)).toBe(true);
  });

  it("evicts the oldest login-failure record once the map exceeds the cap", () => {
    const ip = "victim";
    for (let i = 0; i < 10; i++) registerLoginFailure(ip);
    expect(isLoginLocked(ip)).toBe(true);
    for (let i = 0; i < 10_000; i++) registerLoginFailure(`churn-${i}`);
    expect(isLoginLocked(ip)).toBe(false);
  });

  it("evicts the oldest login bucket once the map exceeds the cap", () => {
    const ip = "victim";
    for (let i = 0; i < 5; i++) checkLoginLimit(ip);
    expect(checkLoginLimit(ip)).toBe(false);
    for (let i = 0; i < 10_000; i++) checkLoginLimit(`churn-${i}`);
    expect(checkLoginLimit(ip)).toBe(true);
  });
});

describe("login failure lockout", () => {
  it("locks after 10 consecutive failures for 15 minutes", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(t0);
    const ip = "9.9.9.9";
    for (let i = 0; i < 9; i++) registerLoginFailure(ip);
    expect(isLoginLocked(ip)).toBe(false);
    registerLoginFailure(ip);
    expect(isLoginLocked(ip)).toBe(true);
    // still locked just before 15 min, free after
    vi.setSystemTime(new Date(t0.getTime() + 15 * 60_000 - 1));
    expect(isLoginLocked(ip)).toBe(true);
    vi.setSystemTime(new Date(t0.getTime() + 15 * 60_000 + 1));
    expect(isLoginLocked(ip)).toBe(false);
  });

  it("clearLoginFailures resets the consecutive count", () => {
    const ip = "8.8.8.8";
    for (let i = 0; i < 9; i++) registerLoginFailure(ip);
    clearLoginFailures(ip);
    for (let i = 0; i < 9; i++) registerLoginFailure(ip);
    expect(isLoginLocked(ip)).toBe(false);
  });

  it("reset seam unlocks", () => {
    const ip = "7.7.7.7";
    for (let i = 0; i < 10; i++) registerLoginFailure(ip);
    expect(isLoginLocked(ip)).toBe(true);
    __resetMuseLimits();
    expect(isLoginLocked(ip)).toBe(false);
  });
});
