// @vitest-environment node
//
// The Docker Engine API is versioned per request (/v1.xx/...). Hardcoding the
// client version broke against the QNAP appliance — its daemon predates v1.46
// and answers unknown versions with a bare 404, which listContainers turned
// into a thrown Error and the admin route surfaced as a 500. These tests pin
// the fix: the client discovers the daemon's maximum via the *unversioned*
// GET /version probe and clamps to it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { listContainers, restartContainer, __resetApiVersionCache } from "@/lib/docker-api";

// Mutable daemon the mocked http.request delegates to, set per test.
const daemon = vi.hoisted(() => ({
  fn: null as ((...args: any[]) => any) | null,
}));

vi.mock("node:http", () => ({
  request: (...args: any[]) => {
    if (!daemon.fn) throw new Error("test did not configure a daemon");
    return daemon.fn!(...args);
  },
}));

const calls: { method: string; path: string }[] = [];

/** A fake daemon that speaks API 1.<maxMinor> and 404s any newer version. */
function fakeDaemon(opts: { maxMinor: number; containers?: any[] }) {
  const { maxMinor, containers = [] } = opts;
  return (requestOpts: any, cb: any) => {
    calls.push({ method: requestOpts.method, path: requestOpts.path });
    const path: string = requestOpts.path;
    const res = new EventEmitter() as any;
    const respond = (statusCode: number, body: string) => {
      // Defer so the caller can attach res.on("data"/"end") first.
      queueMicrotask(() => {
        res.statusCode = statusCode;
        if (body) res.emit("data", Buffer.from(body));
        res.emit("end");
      });
    };
    if (path === "/version") {
      respond(200, JSON.stringify({ ApiVersion: `1.${maxMinor}`, MinAPIVersion: "1.24" }));
    } else {
      // A request for a version newer than the daemon speaks is a 404 — this
      // is exactly what the QNAP did to the old hardcoded v1.46 client.
      // `maxMinor` is the daemon's minor (41 => API 1.41 => rank 141).
      const m = /^\/v(\d+)\.(\d+)\//.exec(path);
      if (m && Number(`${m[1]}${m[2]}`) > 100 + maxMinor) {
        respond(404, "page not found");
      } else if (path.includes("/containers/json")) {
        respond(200, JSON.stringify(containers));
      } else if (path.includes("/restart")) {
        respond(204, "");
      } else {
        respond(404, "page not found");
      }
    }
    cb(res);
    const req = new EventEmitter() as any;
    req.write = vi.fn();
    req.end = vi.fn();
    return req;
  };
}

/** A daemon whose /version probe fails at the socket level (ENOENT/EACCES). */
function probeFailingDaemon(opts: { maxMinor: number; containers?: any[] }) {
  const inner = fakeDaemon(opts);
  return (requestOpts: any, cb: any) => {
    if (requestOpts.path === "/version") {
      calls.push({ method: requestOpts.method, path: requestOpts.path });
      cb(new EventEmitter() as any);
      const req = new EventEmitter() as any;
      req.write = vi.fn();
      req.end = vi.fn();
      queueMicrotask(() => req.emit("error", new Error("connect ENOENT /var/run/docker.sock")));
      return req;
    }
    return inner(requestOpts, cb);
  };
}

const SAMPLE = [
  {
    Id: "abc123",
    Names: ["/pocketbase"],
    Image: "ghcr.io/muchobien/pocketbase:latest",
    State: "running",
    Status: "Up 3 days",
    Ports: [{ PrivatePort: 8090, PublicPort: 8090, Type: "tcp" }],
    Created: "2026-09-01T00:00:00.000Z",
  },
];

function paths(): string[] {
  return calls.map((c) => c.path);
}

beforeEach(() => {
  calls.length = 0;
  daemon.fn = null;
  __resetApiVersionCache();
});

describe("docker-api version negotiation", () => {
  it("discovers the daemon's max version and targets it (not the hardcoded one)", async () => {
    // QNAP-style daemon: only speaks 1.41, 404s on v1.46/v1.47.
    daemon.fn = fakeDaemon({ maxMinor: 41, containers: SAMPLE });
    const containers = await listContainers("pocketbase");
    expect(containers).toHaveLength(1);
    expect(containers[0].name).toBe("pocketbase");
    expect(containers[0].ports).toBe("8090:8090");
    expect(paths()).toContain("/version");
    expect(paths().some((p) => p.startsWith("/v1.41/containers/json"))).toBe(true);
    // The versions that used to be hardcoded must never be requested.
    expect(paths().some((p) => p.startsWith("/v1.46/") || p.startsWith("/v1.47/"))).toBe(false);
  });

  it("clamps a newer daemon down to the client's schema ceiling", async () => {
    daemon.fn = fakeDaemon({ maxMinor: 52, containers: SAMPLE });
    await listContainers("pocketbase");
    expect(paths().some((p) => p.startsWith("/v1.47/containers/json"))).toBe(true);
    expect(paths().some((p) => p.startsWith("/v1.52/"))).toBe(false);
  });

  it("caches the negotiated version so later calls skip the probe", async () => {
    daemon.fn = fakeDaemon({ maxMinor: 43, containers: SAMPLE });
    await listContainers("pocketbase");
    await listContainers("consuela-dashboard");
    expect(paths().filter((p) => p === "/version")).toHaveLength(1);
  });

  it("falls back to the conservative floor when the probe itself fails", async () => {
    daemon.fn = probeFailingDaemon({ maxMinor: 41, containers: SAMPLE });
    const containers = await listContainers("pocketbase");
    expect(containers).toHaveLength(1);
    expect(paths().some((p) => p.startsWith("/v1.41/containers/json"))).toBe(true);
  });

  it("restarts through the negotiated version", async () => {
    daemon.fn = fakeDaemon({ maxMinor: 41, containers: SAMPLE });
    await restartContainer("pocketbase");
    expect(paths().some((p) => p.endsWith("/containers/pocketbase/restart"))).toBe(true);
  });

  it("rejects (rather than silently succeeding) on a real socket error", async () => {
    daemon.fn = () => {
      throw new Error("socket gone");
    };
    await expect(listContainers("pocketbase")).rejects.toThrow();
  });
});
