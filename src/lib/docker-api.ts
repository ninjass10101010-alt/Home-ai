import { request } from "node:http";

const DOCKER_SOCKET = "/var/run/docker.sock";
const API_VERSION = "v1.47";

interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Ports: Array<{ PrivatePort: number; PublicPort: number; Type: string }>;
  Created: string;
}

function dockerRequest<T>(method: string, path: string, body?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: DOCKER_SOCKET,
        path: `/${API_VERSION}${path}`,
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

export interface ContainerInfo {
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
}

export async function listContainers(...names: string[]): Promise<ContainerInfo[]> {
  const filter = JSON.stringify({ name: names });
  const containers = await dockerRequest<DockerContainer[]>(
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
  const containers = await listContainers(name);
  const match = containers.find((c) => c.name === name);
  if (!match) throw new Error(`Container "${name}" not found`);
  await dockerRequest("POST", `/containers/${name}/restart`);
}

export async function containerHealth(name: string): Promise<ContainerInfo | null> {
  const containers = await listContainers(name);
  return containers.find((c) => c.name === name) || null;
}
