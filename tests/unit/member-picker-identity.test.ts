import { describe, expect, it } from "vitest";
import { sanitizeMemberPickerIdentity } from "@/lib/member-picker-identity";

describe("sanitizeMemberPickerIdentity", () => {
  it("preserves only opaque live PB IDs and never promotes fallback numeric IDs", () => {
    expect(sanitizeMemberPickerIdentity({ name: "Jon", pbId: "pb_member_123" })).toMatchObject({ pbId: "pb_member_123" });
    expect(sanitizeMemberPickerIdentity({ name: "Jon", pbId: 123 })).not.toHaveProperty("pbId");
    expect(sanitizeMemberPickerIdentity({ name: "Jon", id: 3 })).not.toHaveProperty("pbId");
  });
  it("returns only normalized picker identity fields", () => {
    const identity = sanitizeMemberPickerIdentity({
      name: "  Bailey Rivera  ",
      emoji: "data:image/png;base64,YWJj",
      color: "violet",
      avatarSize: "base",
      glow: "yes",
      role: "Child",
      age: 8,
      pin: "5678",
      image: "https://example.com/photo.png",
      dataUrl: "data:image/jpeg;base64,def456",
      arbitrary: { secret: "excluded" },
    });

    expect(identity).toEqual({
      name: "Bailey Rivera",
      emoji: "data:image/png;base64,YWJj",
      color: "violet",
      avatarSize: "md",
      glow: true,
    });
    expect(Object.keys(identity!).sort()).toEqual([
      "avatarSize",
      "color",
      "emoji",
      "glow",
      "name",
    ]);
  });

  it.each([
    "//tracker.example/pixel.png",
    "tracker.example/pixel.png",
    "image.gif?x",
    "https://tracker.example/pixel",
    "http://tracker.example/pixel",
    "HTTPS://tracker.example/pixel.png",
  ])("rejects external SigmaImage request value %s", (emoji) => {
    const identity = sanitizeMemberPickerIdentity({ name: "Bailey", emoji });

    expect(identity).toEqual({ name: "Bailey", avatarSize: "md", glow: false });
    expect(identity).not.toHaveProperty("emoji");
  });

  it.each([
    "data:image/png;base64,YWJj",
    "data:image/jpeg;base64,YWJjZA==",
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    "data:image/webp;base64,UklGRhIAAABXRUJQ",
  ])("preserves approved raster data image %s", (emoji) => {
    expect(sanitizeMemberPickerIdentity({ name: "Bailey", emoji })?.emoji).toBe(emoji);
  });

  it.each([
    "data:image/png;base64,",
    "data:image/png;base64,Y",
    "data:image/png;base64,YW Jj",
    "data:image/png;base64,YW_jj",
    "data:image/png;base64,YWJj=",
    "data:image/png,YWJj",
    "data:image/jpg;base64,YWJj",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:text/plain;base64,SGVsbG8=",
  ])("rejects malformed or unsupported data image %s", (emoji) => {
    expect(sanitizeMemberPickerIdentity({ name: "Bailey", emoji })).toEqual({
      name: "Bailey",
      avatarSize: "md",
      glow: false,
    });
  });

  it("accepts a valid raster data image at exactly 400000 characters", () => {
    const prefix = "data:image/png;base64,";
    const emoji = `${prefix}${"A".repeat(400_000 - prefix.length)}`;

    expect(emoji).toHaveLength(400_000);
    expect(sanitizeMemberPickerIdentity({ name: "Bailey", emoji })?.emoji).toBe(emoji);
  });

  it("rejects an otherwise valid raster data image at 400001 characters", () => {
    const prefix = "data:image/png;base64,";
    const emoji = `${prefix}${"A".repeat(400_001 - prefix.length)}`;

    expect(emoji).toHaveLength(400_001);
    const identity = sanitizeMemberPickerIdentity({ name: "Bailey", emoji });
    expect(identity).toMatchObject({ name: "Bailey", avatarSize: "md", glow: false });
    expect(identity).not.toHaveProperty("emoji");
  });

  it("keeps ordinary emoji unchanged", () => {
    const emoji = "👨‍👩‍👧‍👦 🐶 ⚽";

    expect(sanitizeMemberPickerIdentity({ name: "Bailey", emoji })?.emoji).toBe(emoji);
  });

  it("excludes unsafe URLs, invalid colors, and arbitrary identity fields", () => {
    const identity = sanitizeMemberPickerIdentity({
      name: "Rocco",
      emoji: "🐶",
      color: "not-a-color",
      avatarSize: "huge",
      glow: 0,
      image: "https://example.com/photo.png",
      dataUrl: "data:text/html,bad",
      role: "Pet",
      age: 4,
      pin: "9999",
      joined: "2020-01-01",
    });

    expect(identity).toEqual({
      name: "Rocco",
      emoji: "🐶",
      avatarSize: "md",
      glow: false,
    });
    expect(Object.keys(identity!).sort()).toEqual(["avatarSize", "emoji", "glow", "name"]);
    expect(identity).not.toHaveProperty("image");
    expect(identity).not.toHaveProperty("dataUrl");
    expect(identity).not.toHaveProperty("role");
    expect(identity).not.toHaveProperty("age");
    expect(identity).not.toHaveProperty("pin");
  });

  it("rejects missing names and non-object roster values", () => {
    expect(sanitizeMemberPickerIdentity({ name: "   " })).toBeNull();
    expect(sanitizeMemberPickerIdentity({ name: 42 })).toBeNull();
    expect(sanitizeMemberPickerIdentity(null)).toBeNull();
    expect(sanitizeMemberPickerIdentity("Bailey")).toBeNull();
  });
});
