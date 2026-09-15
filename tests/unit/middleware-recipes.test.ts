/**
 * F8e — the recipes exemption was narrowed from the whole `/api/recipes/`
 * prefix to the public catalog search only. `/api/recipes/ingest` does a
 * server-side fetch/scrape of an arbitrary URL, so it must require a session.
 */
import { describe, it, expect } from "vitest";
import { isExempt } from "@/middleware";

describe("recipes API exemption split (F8e)", () => {
  it("exempts the public /api/recipes/search catalog lookup", () => {
    expect(isExempt("/api/recipes/search")).toBe(true);
  });
  it("still exempts deep subpaths of the search route", () => {
    expect(isExempt("/api/recipes/search/by-id")).toBe(true);
  });
  it("gates the /api/recipes/ingest URL-fetch route", () => {
    expect(isExempt("/api/recipes/ingest")).toBe(false);
  });
  it("gates the bare /api/recipes prefix", () => {
    expect(isExempt("/api/recipes")).toBe(false);
  });
  it("does NOT exempt /api/tasks", () => {
    expect(isExempt("/api/tasks")).toBe(false);
  });
  it("does NOT exempt /api/db", () => {
    expect(isExempt("/api/db")).toBe(false);
  });
});
