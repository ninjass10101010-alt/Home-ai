import { describe, expect, it } from "vitest";
import {
  SETTINGS_SECTIONS,
  isSettingsSectionId,
  settingsSectionsForRole,
} from "@/lib/settings-sections";

describe("settings section registry", () => {
  it("keeps the approved parent order", () => {
    expect(settingsSectionsForRole("parent").map((section) => section.id)).toEqual([
      "me",
      "family",
      "safety",
      "appearance",
      "home",
      "system",
    ]);
  });

  it.each(["guest", "child", "pet"] as const)("keeps only safe sections for %s", (role) => {
    expect(settingsSectionsForRole(role).map((section) => section.id)).toEqual([
      "me",
      "safety",
      "appearance",
    ]);
  });

  it("returns a fresh filtered list without changing the registry", () => {
    const first = settingsSectionsForRole("child");
    first.pop();

    expect(settingsSectionsForRole("child")).toHaveLength(3);
    expect(SETTINGS_SECTIONS).toHaveLength(6);
  });

  it("guards every known route and rejects other values", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(isSettingsSectionId(section.id)).toBe(true);
    }

    expect(isSettingsSectionId("family")).toBe(true);
    expect(isSettingsSectionId("unknown")).toBe(false);
    expect(isSettingsSectionId(null)).toBe(false);
    expect(isSettingsSectionId(42)).toBe(false);
  });
});
