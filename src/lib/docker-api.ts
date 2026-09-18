import { request } from "node:http";

const DOCKER_SOCKET = "/var/run/docker.sock";

// The Docker Engine API is versioned per request (/v1.xx/...). Pinning the
// client to one version breaks against daemons that predate it — the QNAP
// appliance answers an unknown version with a bare 404, which listContainers
// turned into a thrown Error and the admin route surfaced as a 500. Instead of
// guessing, the client discovers the daemon's maximum via the *unversioned*
// GET /version probe (accepted by every daemon regardless of version) and
// clamps to the lower of the two. A failed probe is NOT cached: a transient
// socket error should not pin the fallback for the life of the process.
const CLIENT_MAX_API_VERSION = { major: 1, minor: 47 }; // Docker 27.x — our schema ceiling
const FALLBACK_API_VERSION = { major: 1, minor: 41 }; // Docker 20.10 — the widely available floor

interface ApiVersion {
  major: number;
  minor: number;
}

let resolvedApiVersion: ApiVersion | null = null;

/** Test hook: drop the cached negotiation between cases. */
export function __resetApiVersionCache(): void {
  resolvedApiVersion = null;
}

interface DockerVersionInfo {
  ApiVersion?: string;
  MinAPIVersion?: string;
}

interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Ports: Array<{ PrivatePort: number; PublicPort: number; Type: string }>;
  Created: string;
}

/** "1.43" / "1.43.1" -> {major:1, minor:43}; null when unparseable. */
function parseApiVersion(v: string | undefined | null): ApiVersion | null {
  if (typeof v !== "string") return null;
  const m = /^(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/** The request-path form (`v1.41`) and the orderable rank (`141`). */
function versionKey(v: ApiVersion): string {
  return `v${v.major}.${v.minor}`;
}
function versionRank(v: ApiVersion): number {
  return v.major * 100 + v.minor;
}

/**
 * Resolve the API version to prefix requests with. `version: null` means the
 * unversioned probe itself (accepted by every daemon).
 */
function dockerRequest<T>(
  version: string | null,
  method: string,
  path: string,
  body?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: DOCKER_SOCKET,
        path: version === null ? path : `/${version}${path}`,
        method,
        headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(raw ? JSON.parse(raw) : ({} as T));
            } catch {
              resolve(raw as unknown as T);
            }
          } else {
            reject(new Error(`Docker API ${res.statusCode}: ${raw.slice(0, 500)}`));
          }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function resolveApiVersion(): Promise<string> {
  if (resolvedApiVersion !== null) return versionKey(resolvedApiVersion);
  try {
    const info = await dockerRequest<DockerVersionInfo>(null, "GET", "/version");
    const daemonMax = parseApiVersion(info?.ApiVersion);
    resolvedApiVersion = !daemonMax
      ? FALLBACK_API_VERSION
      : versionRank(daemonMax) <= versionRank(CLIENT_MAX_API_VERSION)
        ? daemonMax
        : CLIENT_MAX_API_VERSION;
  } catch {
    // Probe failure (socket down / refused) → assume the conservative floor
    // and retry the probe on a later call rather than caching the failure.
    return versionKey(FALLBACK_API_VERSION);
  }
  return versionKey(resolvedApiVersion);
}

export interface ContainerInfo {
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
}

export async function listContainers(...names: string[]): Promise<ContainerInfo[]> {
  const version = await resolveApiVersion();
  const filter = JSON.stringify({ name: names });
  const containers = await dockerRequest<DockerContainer[]>(
    version,
    "GET",
    `/containers/json?all=true&filters=${encodeURIComponent(filter)}`,
  );
  return (containers || []).map((c) => ({
    name: (c.Names || [])[0]?.replace(/^\//, "") || c.Id?.substring(0, 12) || "unknown",
    image: c.Image || "",
    state: c.State || "",
    status: c.Status || "",
    ports: (c.Ports || []).map((p) => `${p.PrivatePort}:${p.PublicPort || ""}`).join(", ") || "",
    created: c.Created || "",
  }));
}

export async function restartContainer(name: string): Promise<void> {
  const version = await resolveApiVersion();
  const containers = await listContainers(name);
  const match = containers.find((c) => c.name === name);
  if (!match) throw new Error(`Container "${name}" not found`);
  await dockerRequest("POST", version, `/containers/${name}/restart`);
}

export async function containerHealth(name: string): Promise<ContainerInfo | null> {
  const containers = await listContainers(name);
  return containers.find((c) => c.name === name) || null;
}
