// @vitest-environment jsdom
/**
 * Audit P0-4 (phase 2) — `useSafeFetch` behaviour contract.
 *
 * These are the four promises the UI is allowed to make to a family:
 *   1. a spinner means work is genuinely in flight, and stops the moment it is not;
 *   2. "no rows" is only ever shown for a *successful* empty read;
 *   3. a failed refresh keeps the last good data and says it is a saved copy;
 *   4. a screen that failed can heal itself when the network comes back.
 */
import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSafeFetch, type SafeFetch, type UseSafeFetchOptions } from "@/hooks/useSafeFetch";
import { READ_COPY, READ_COPY_OFFLINE_EMPTY, READ_COPY_STALE } from "@/lib/read-state";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Rows = Array<{ id: string }>;
type Snap = SafeFetch<Rows>;

let snapshots: Snap[] = [];
let root: Root | null = null;
const capture = (snap: Snap) => {
  snapshots.push(snap);
};

function Probe(props: { read: () => Promise<Rows>; options: UseSafeFetchOptions<Rows> }) {
  const result = useSafeFetch<Rows>(props.read, props.options);
  // Snapshot at commit time (not during render) so the probe itself is lint-clean.
  useEffect(() => {
    capture({ ...result });
  });
  return null;
}

async function renderProbe(
  read: () => Promise<Rows>,
  options: Partial<UseSafeFetchOptions<Rows>> = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<Probe read={read} options={{ initial: [], ...options }} />);
  });
}

async function rerenderProbe(
  read: () => Promise<Rows>,
  options: Partial<UseSafeFetchOptions<Rows>> = {},
) {
  await act(async () => {
    root!.render(<Probe read={read} options={{ initial: [], ...options }} />);
  });
}

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function latest(): Snap {
  const snap = snapshots[snapshots.length - 1];
  if (!snap) throw new Error("probe never rendered");
  return snap;
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

function goOnline() {
  setOnline(true);
  window.dispatchEvent(new Event("online"));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  snapshots = [];
  setOnline(true);
});

afterEach(async () => {
  // Unmount inside act and before the body is wiped — the same portal/teardown
  // trap as tasks-approve-all.test.tsx (commit 05f1005), plus React 19 warns on
  // an unmounted root outside act.
  const active = root;
  root = null;
  if (active) await act(async () => active.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useSafeFetch — healthy reads", () => {
  it("goes loading -> ready and reports no problem", async () => {
    await renderProbe(async () => [{ id: "a" }]);
    expect(snapshots[0].state).toBe("loading");
    await flush();
    expect(latest().state).toBe("ready");
    expect(latest().data).toEqual([{ id: "a" }]);
    expect(latest().loaded).toBe(true);
    expect(latest().stale).toBe(false);
    expect(latest().message).toBeNull();
  });

  it("calls a successful empty read 'empty' — the state the old code faked", async () => {
    await renderProbe(async () => []);
    await flush();
    expect(latest().state).toBe("empty");
    expect(latest().loaded).toBe(true);
    // `empty` is not a failure, so the hook stays quiet and the widget owns copy.
    expect(latest().message).toBeNull();
  });

  it("honours a custom isEmpty for non-array payloads", async () => {
    await renderProbe(async () => [{ id: "a" }], {
      initial: [],
      isEmpty: () => true,
    });
    await flush();
    expect(latest().state).toBe("empty");
  });
});

describe("useSafeFetch — failures never render as absence", () => {
  it("a 401 becomes a sign-in prompt, not an empty list", async () => {
    await renderProbe(async () => {
      throw { status: 401 };
    });
    await flush();
    expect(latest().state).toBe("unauthorised");
    expect(latest().message).toBe(READ_COPY.unauthorised);
    // The wall bug this replaces: nothing loaded, so nothing may be claimed.
    expect(latest().loaded).toBe(false);
    expect(latest().data).toEqual([]);
  });

  it("a dropped connection becomes 'offline' and stops the spinner", async () => {
    setOnline(false);
    await renderProbe(async () => {
      throw new TypeError("Failed to fetch");
    });
    await flush();
    expect(latest().state).toBe("offline");
    // Nothing ever loaded, so there is no saved copy to promise — the offline
    // wording that claims one would be its own small lie.
    expect(latest().message).toBe(READ_COPY_OFFLINE_EMPTY);
    // This is the AdultHome weather bug: it used to sit at "Loading…" forever.
    expect(latest().state).not.toBe("loading");
  });

  it("keeps the last good rows and calls them a saved copy when a refresh fails", async () => {
    let fail = false;
    await renderProbe(async () => {
      if (fail) throw { status: 500 };
      return [{ id: "fresh" }];
    });
    await flush();
    expect(latest().state).toBe("ready");

    fail = true;
    await act(async () => {
      latest().retry();
    });
    await flush();

    expect(latest().state).toBe("error");
    expect(latest().stale).toBe(true);
    expect(latest().loaded).toBe(true);
    expect(latest().data).toEqual([{ id: "fresh" }]);
    expect(latest().message).toBe(READ_COPY_STALE);
  });

  it("retry() re-reads and clears the failure", async () => {
    let fail = true;
    await renderProbe(async () => {
      if (fail) throw { status: 503 };
      return [{ id: "back" }];
    });
    await flush();
    expect(latest().state).toBe("error");

    fail = false;
    await act(async () => {
      latest().retry();
    });
    await flush();

    expect(latest().state).toBe("ready");
    expect(latest().data).toEqual([{ id: "back" }]);
    expect(latest().stale).toBe(false);
    expect(latest().message).toBeNull();
  });

  it("heals itself when the browser comes back online, without a reload", async () => {
    let online = false;
    setOnline(false); // must be false before the first read, or it classifies while still online
    await renderProbe(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return [{ id: "healed" }];
    });
    await flush();
    expect(latest().state).toBe("offline");

    online = true;
    await act(async () => {
      goOnline();
    });
    await flush();

    expect(latest().state).toBe("ready");
    expect(latest().data).toEqual([{ id: "healed" }]);
  });

  it("waits for permission when disabled, then reads once enabled", async () => {
    const read = vi.fn(async () => [{ id: "gated" }]);
    await renderProbe(read, { enabled: false });
    await flush();
    expect(read).not.toHaveBeenCalled();

    await rerenderProbe(read, { enabled: true });
    await flush();
    expect(read).toHaveBeenCalled();
    expect(latest().state).toBe("ready");
  });

  it("treats a new key as new subject matter: drops the old rows, re-reads", async () => {
    await renderProbe(async () => [{ id: "lat-42" }], { key: "42,-83" });
    await flush();
    expect(latest().data).toEqual([{ id: "lat-42" }]);

    await rerenderProbe(async () => [{ id: "lat-43" }], { key: "43,-83" });
    await flush();
    expect(latest().data).toEqual([{ id: "lat-43" }]);
    expect(latest().state).toBe("ready");
  });

  it("ignores a slow answer from a superseded key", async () => {
    const slow = deferred<Rows>();
    const fast = deferred<Rows>();

    await renderProbe(() => slow.promise, { key: "old" });
    await rerenderProbe(() => fast.promise, { key: "new" });

    fast.resolve([{ id: "new" }]);
    await act(async () => {
      await Promise.resolve();
    });
    await flush();
    expect(latest().data).toEqual([{ id: "new" }]);

    // The abandoned read lands late; it must not overwrite the current subject.
    slow.resolve([{ id: "old" }]);
    await act(async () => {
      await Promise.resolve();
    });
    await flush();
    expect(latest().data).toEqual([{ id: "new" }]);
  });
});
