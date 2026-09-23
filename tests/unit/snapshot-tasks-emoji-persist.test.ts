import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(async (fn: (pb: unknown) => Promise<unknown>) => fn(mockPb)),
}));

// Minimal PB whose tasks collection records create/update payloads.
const mockPb = {
  collection: (name: string) => {
    if (name === "tasks") {
      return {
        getFullList: async () => [] as any[],
        create: async (payload: any) => {
          created.push(payload);
          return payload;
        },
        update: async (_id: string, payload: any) => payload,
        delete: async () => undefined,
      };
    }
    return {
      getFullList: async () => [] as any[],
      update: async (_id: string, payload: any) => payload,
      create: async (payload: any) => payload,
    };
  },
};

let created: any[] = [];

vi.mock("@/lib/pb-auth", () => ({ withAdmin: (fn: any) => mocks.withAdmin(fn) }));
vi.mock("@/lib/keyed-lock", () => ({ withKeyedLock: (_k: string, fn: any) => fn() }));

import { mirrorTaskToCollection } from "@/lib/snapshot-tasks";
import { PB_TASK_EMOJI_MAX } from "@/lib/task-emoji";

const PHOTO = `data:image/webp;base64,${"C".repeat(209_834)}`;

beforeEach(() => {
  created = [];
});

describe("mirrorTaskToCollection assigneeEmoji sanitization", () => {
  it("collapses a photo assigneeEmoji before the PB create (max=5000)", async () => {
    await mirrorTaskToCollection("upsert", {
      id: 42,
      title: "Guest Bathroom",
      assignee: "Emily",
      assigneeEmoji: PHOTO,
      points: 10,
      completed: false,
    } as any);
    expect(created).toHaveLength(1);
    expect(created[0].assigneeEmoji).toBe("👤");
    expect(String(created[0].assigneeEmoji).length).toBeLessThanOrEqual(
      PB_TASK_EMOJI_MAX
    );
  });

  it("keeps a short glyph intact", async () => {
    await mirrorTaskToCollection("upsert", {
      id: 43,
      title: "Shoes",
      assignee: "Bailey",
      assigneeEmoji: "👧",
      points: 5,
      completed: false,
    } as any);
    expect(created[0].assigneeEmoji).toBe("👧");
  });
});
