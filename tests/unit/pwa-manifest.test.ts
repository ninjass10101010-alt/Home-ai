import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

describe("web app manifest", () => {
  it("is installable: name, start_url, standalone, themed, icons", () => {
    const m = manifest();
    expect(m.name).toBe("Consuela — AI Family Organizer");
    expect(m.short_name).toBe("Consuela");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#0f1117");
    expect(m.theme_color).toBe("#0f1117");
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
  });
});