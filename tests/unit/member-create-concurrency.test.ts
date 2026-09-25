import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withAdmin: vi.fn(),
  randomInt: vi.fn(),
}));

vi.mock("node:crypto", () => ({ randomInt: mocks.randomInt }));
vi.mock("@/lib/pb-auth", () => ({
  withAdmin: (fn: (pb: unknown) => Promise<unknown>) => mocks.withAdmin(fn),
}));

import { createMemberRecord } from "@/lib/server-auth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.withAdmin.mockReset();
  mocks.randomInt.mockReset();
});

describe("createMemberRecord concurrency", () => {
  it("serializes concurrent creates so starter PIN allocation re-reads live rows", async () => {
    const rows: any[] = [];
    const firstRead = deferred<void>();
    const releaseCreate = deferred<void>();
    let reads = 0;
    let randomCalls = 0;
    mocks.randomInt.mockImplementation(() => {
      randomCalls += 1;
      return randomCalls <= 2 ? 12 : 34;
    });
    mocks.withAdmin.mockImplementation((fn: (pb: unknown) => Promise<unknown>) => fn({
      collection: () => ({
        getFullList: async () => {
          reads += 1;
          if (reads === 1) firstRead.resolve();
          return rows;
        },
        create: async (payload: any) => {
          await releaseCreate.promise;
          const row = { id: `row-${rows.length + 1}`, ...payload };
          rows.push(row);
          return row;
        },
      }),
    }));

    const first = createMemberRecord({ name: "Nova One", role: "child" });
    await firstRead.promise;
    const second = createMemberRecord({ name: "Nova Two", role: "child" });
    await Promise.resolve();
    releaseCreate.resolve();
    const [firstRow, secondRow] = await Promise.all([first, second]);

    expect(firstRow.pin).not.toBe(secondRow.pin);
    expect(new Set(rows.map((row) => row.pin)).size).toBe(2);
  });
});
