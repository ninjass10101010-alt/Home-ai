// The gateway sanitizer used /pin|secret|password|token/i, which stripped
// `pinned` (the grocery manual-override pin flag) from every gateway grocery
// write — silent data loss on the Shop tab's 📌 pin. The rule's intent is
// credential fields (pin/pins/pinCode variants, secret/password/token) — NOT
// the boolean "pinned" flag.
import { describe, it, expect } from "vitest";
import { sanitizeClientRow } from "@/lib/db-gateway";

describe("sanitizeClientRow pin carve-out", () => {
  it("preserves the grocery manual-override `pinned` flag", () => {
    const out = sanitizeClientRow({ name: "Milk", pinned: true, needed: true });
    expect(out.pinned).toBe(true);
  });

  it("preserves pinned-style keys (isPinned, manualPinned)", () => {
    const out = sanitizeClientRow({ isPinned: true, manualPinned: true });
    expect(out.isPinned).toBe(true);
    expect(out.manualPinned).toBe(true);
  });

  it("strips credential-looking pin keys", () => {
    const out = sanitizeClientRow({
      pin: "1234",
      pins: ["1", "2"],
      pinCode: "12",
      pin_code: "12",
      "pin-code": "12",
      memberPin: "12",
    });
    expect(out).not.toHaveProperty("pin");
    expect(out).not.toHaveProperty("pins");
    expect(out).not.toHaveProperty("pinCode");
    expect(out).not.toHaveProperty("pin_code");
    expect(out).not.toHaveProperty("pin-code");
    expect(out).not.toHaveProperty("memberPin");
  });

  it("still strips secret/password/token fields", () => {
    const out = sanitizeClientRow({
      password: "hunter2",
      secret: "s",
      apiToken: "t",
      resetToken: "r",
      passwordHash: "h",
    });
    expect(out).not.toHaveProperty("password");
    expect(out).not.toHaveProperty("secret");
    expect(out).not.toHaveProperty("apiToken");
    expect(out).not.toHaveProperty("resetToken");
    expect(out).not.toHaveProperty("passwordHash");
  });

  it("keeps existing internal-field stripping behavior", () => {
    const out = sanitizeClientRow({
      id: "abc",
      created: "2026-01-01",
      updated: "2026-01-02",
      collectionId: "c1",
      collectionName: "grocery_list_items",
      name: "Eggs",
    });
    expect(out).not.toHaveProperty("id");
    expect(out).not.toHaveProperty("created");
    expect(out).not.toHaveProperty("updated");
    expect(out).not.toHaveProperty("collectionId");
    expect(out).not.toHaveProperty("collectionName");
    expect(out.name).toBe("Eggs");
  });
});
