// tests/unit/emergency-live-contacts.test.ts
// F1: the emergency path read a process-start cache; a corrected contact was
// ignored until container restart. It must read PB live, and fall back to the
// cache only when the live read fails (flagged honestly).
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Record<string, any[]> = {};
let failLive = false;
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: vi.fn(async (fn: any) => {
    if (failLive) throw new Error("PB down");
    return fn({ collection: (name: string) => ({ getFullList: async () => rows[name] ?? [] }) });
  }),
  getAuthedPB: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: {
    selectEmergencyContacts: () => [{ id: "stale", name: "Old Contact", phone: "+10000000000", isPrimary: true }],
  },
}));
import { getTool } from "@/lib/hermes-tools";
import { GET } from "@/app/api/emergency-contacts/route";

beforeEach(() => { for (const k of Object.keys(rows)) delete rows[k]; failLive = false; });

it("reads contacts live, not from the stale cache", async () => {
  rows.emergency_contacts = [{ id: "fresh", name: "Rebecca", phone: "+15550001111", isPrimary: true, role: "primary" }];
  const res = await GET();
  const body = await res.json();
  expect(JSON.stringify(body)).toContain("Rebecca");
  expect(JSON.stringify(body)).not.toContain("Old Contact");
  expect(body.contactsSource).toBe("live");
});

it("falls back to the cache when PB fails, flagged honestly", async () => {
  failLive = true;
  const res = await GET();
  const body = await res.json();
  expect(JSON.stringify(body)).toContain("Old Contact");
  expect(body.contactsSource).toBe("cache");
});
