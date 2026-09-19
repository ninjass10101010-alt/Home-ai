import { describe, it, expect } from "vitest";
import {
  mergeThread,
  sortThread,
  visibleThread,
  lastResetIndex,
  threadKey,
  SEED_GREETING_ID,
} from "@/lib/chat-thread";

type M = { id: number; role: "user" | "assistant" | "system"; content: string; at?: number; proposal?: string };

const msg = (id: number, role: M["role"], content: string, at?: number, extra: Partial<M> = {}): M =>
  ({ id, role, content, at, ...extra });

describe("threadKey", () => {
  it("ignores speaker so a signed-out local row matches its PB guest row", () => {
    expect(threadKey({ role: "user", content: "hi" })).toBe(threadKey({ role: "user", content: "hi" }));
    // role + content only — no speaker segment
    expect(threadKey({ role: "user", content: "hi" })).toBe("user\u0000hi");
  });

  it("distinguishes role and content", () => {
    expect(threadKey({ role: "user", content: "hi" })).not.toBe(threadKey({ role: "assistant", content: "hi" }));
    expect(threadKey({ role: "user", content: "hi" })).not.toBe(threadKey({ role: "user", content: "bye" }));
  });
});

describe("sortThread", () => {
  it("orders ascending by at", () => {
    const out = sortThread([msg(3, "assistant", "c", 3000), msg(1, "user", "a", 1000), msg(2, "assistant", "b", 2000)]);
    expect(out.map((m) => m.content)).toEqual(["a", "b", "c"]);
  });

  it("breaks a same-timestamp tie request-before-reply and is stable", () => {
    const out = sortThread([
      msg(1, "assistant", "reply", 5000),
      msg(2, "user", "request", 5000),
      msg(3, "assistant", "later-reply", 5000),
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    // stable: the two assistants keep their original relative order
    expect(out.map((m) => m.content)).toEqual(["request", "reply", "later-reply"]);
  });

  it("treats a missing at as 0 (legacy rows sort first)", () => {
    const out = sortThread([msg(2, "user", "new", 1000), msg(1, "assistant", "old")]);
    expect(out.map((m) => m.content)).toEqual(["old", "new"]);
  });

  it("does not mutate the input array", () => {
    const input = [msg(2, "user", "b", 2000), msg(1, "user", "a", 1000)];
    const snapshot = input.map((m) => m.content);
    sortThread(input);
    expect(input.map((m) => m.content)).toEqual(snapshot);
  });
});

describe("lastResetIndex / visibleThread", () => {
  it("finds the newest reset marker in sorted order", () => {
    const sorted = sortThread([
      msg(1, "user", "old", 100),
      msg(2, "system", "New conversation", 200),
      msg(3, "user", "newer", 300),
      msg(4, "system", "New conversation", 400),
      msg(5, "assistant", "after", 500),
    ]);
    expect(lastResetIndex(sorted)).toBe(3);
  });

  it("returns -1 when there is no marker", () => {
    expect(lastResetIndex([msg(1, "user", "hi", 1), msg(2, "assistant", "yo", 2)])).toBe(-1);
  });

  it("slices from the newest marker and hides everything before it", () => {
    const sorted = sortThread([
      msg(1, "user", "before", 100),
      msg(2, "system", "New conversation", 200),
      msg(3, "user", "after", 300),
    ]);
    expect(visibleThread(sorted).map((m) => m.content)).toEqual(["New conversation", "after"]);
  });

  it("returns the whole thread when there is no marker", () => {
    const sorted = sortThread([msg(10, "user", "a", 100), msg(11, "assistant", "b", 200)]);
    expect(visibleThread(sorted)).toHaveLength(2);
  });

  it("drops the seed greeting once a user message exists", () => {
    const sorted = sortThread([
      msg(SEED_GREETING_ID, "assistant", "What can I help you with today? 🏡", 0),
      msg(50, "user", "hi", 100),
      msg(51, "assistant", "hello", 101),
    ]);
    expect(visibleThread(sorted).some((m) => m.id === SEED_GREETING_ID)).toBe(false);
    expect(visibleThread(sorted).map((m) => m.content)).toEqual(["hi", "hello"]);
  });

  it("keeps the seed greeting in an untouched thread", () => {
    const sorted = sortThread([msg(SEED_GREETING_ID, "assistant", "What can I help you with today? 🏡", 0)]);
    expect(visibleThread(sorted).map((m) => m.id)).toEqual([SEED_GREETING_ID]);
  });
});

describe("mergeThread", () => {
  it("dedupes a PB user row against a local row that carries a different speaker", () => {
    const local = [msg(101, "user", "hi", 1000)];
    const pb = [msg(2_000_001, "user", "hi", 1000)];
    const merged = mergeThread(local, pb);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(101); // keeps the existing (UI-carrying) row
  });

  it("keeps the prev row's UI-only fields and never drops a prev row", () => {
    const local = [msg(101, "assistant", "the answer", 2000, { proposal: "chip" })];
    const merged = mergeThread(local, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].proposal).toBe("chip");
  });

  it("adds genuinely new incoming rows", () => {
    const merged = mergeThread([msg(101, "user", "hi", 1000)], [
      msg(2_000_001, "user", "hi", 1000),
      msg(2_000_002, "assistant", "hello", 1001),
    ]);
    expect(mergeThread(merged, []).map((m) => m.content)).toEqual(["hi", "hello"]);
  });

  it("preserves multiset counts for genuinely repeated messages", () => {
    const local = [msg(101, "user", "ok", 1000)];
    const incoming = [msg(2_000_001, "user", "ok", 1000), msg(2_000_002, "user", "ok", 2000)];
    // local already covers one of the two → append exactly one more
    expect(mergeThread(local, incoming)).toHaveLength(2);
  });

  it("does not drop optimistic rows when hydration lands late (the RC1 fix)", () => {
    const optimistic = [msg(101, "user", "just sent", 5000)];
    const pbHistory = [msg(2_000_001, "user", "older", 1000), msg(2_000_002, "assistant", "older reply", 1001)];
    const merged = sortThread(mergeThread(optimistic, pbHistory));
    // The optimistic row survives, and the merged thread is chronological.
    expect(merged.map((m) => m.content)).toEqual(["older", "older reply", "just sent"]);
  });

  it("sorts a backdated incoming row into the middle, not the end (RC1 ordering)", () => {
    const local = [
      msg(101, "user", "q", 1000),
      msg(102, "assistant", "a", 1001),
    ];
    // A Telegram row arrives late but belongs between the request and reply.
    const backdated = [msg(2_000_001, "user", "mid", 1000, { role: "user" })];
    const merged = sortThread(mergeThread(local, backdated));
    // tie at 1000 → user-before-assistant, so "mid" sorts with the requests
    const contents = merged.map((m) => m.content);
    expect(contents.indexOf("mid")).toBeLessThan(contents.indexOf("a"));
  });
});
