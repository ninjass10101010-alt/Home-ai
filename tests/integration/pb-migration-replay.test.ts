import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import PocketBase from "pocketbase";

import { COLLECTIONS, collectionFieldsForSeed } from "@/lib/pb-seed";
import type { PbCollectionContract, PbSchemaFieldContract } from "@/lib/pb-seed";

const REQUIRED_POCKETBASE_VERSION = "0.39.11";
const MIGRATIONS_DIR = resolve(__dirname, "../../../pb_migrations");
const TERMINAL_MIGRATION_FILE = "1790250000_terminal_locked_task_schema.js";
const REPLAY_SCHEMA_COLLECTIONS = ["members", "tasks"] as const;
const RULE_NAMES = [
  "listRule",
  "viewRule",
  "createRule",
  "updateRule",
  "deleteRule",
] as const;
type ReplayServer = ChildProcessByStdio<null, Readable, Readable>;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 150;
const SHUTDOWN_GRACE_MS = 5_000;
const MAX_CAPTURED_LOG_LINES = 40;
const MAX_REPORTED_ISSUE_CHARS = 8_000;

type LiveField = Record<string, unknown> & { name?: unknown };
type LiveCollection = Record<string, unknown> & {
  name?: unknown;
  system?: unknown;
  fields?: unknown;
  indexes?: unknown;
};

function contractFor(name: string): PbCollectionContract {
  const contract = COLLECTIONS.find((entry) => entry.name === name);
  if (!contract) {
    throw new Error(`src/lib/pb-seed.ts declares no contract for ${name}`);
  }
  return contract;
}

function describeRule(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value === "") return "an empty (publicly open) rule";
  if (typeof value === "string") return "a non-empty rule expression";
  return typeof value;
}

function liveBound(field: LiveField, key: "min" | "max"): number | undefined {
  if (typeof field[key] === "number") return field[key] as number;
  const options = field.options as Record<string, unknown> | undefined;
  return typeof options?.[key] === "number" ? (options[key] as number) : undefined;
}

function liveValues(field: LiveField): string[] {
  const values = field.values;
  return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

function sameValueSet(live: string[], expected: readonly string[]): boolean {
  if (live.length !== expected.length) return false;
  const sortedLive = [...live].sort();
  const sortedExpected = [...expected].slice().sort();
  return sortedLive.every((value, index) => value === sortedExpected[index]);
}

function indexName(spec: string): string {
  const match = spec.match(/INDEX\s+(\S+)\s+ON/i);
  return match ? match[1] : spec;
}

function liveIndexName(index: unknown): string {
  if (typeof index === "string") return indexName(index);
  const name = (index as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

function fieldIssues(
  collectionName: string,
  expected: PbSchemaFieldContract,
  actual: LiveField | undefined,
  issues: string[]
): void {
  const label = `${collectionName}.${expected.name}`;
  if (!actual) {
    issues.push(`${label}: field missing from the replayed schema`);
    return;
  }
  const actualType = String(actual.type ?? "");
  if (actualType !== expected.type) {
    issues.push(`${label}: expected type ${expected.type}, replayed ${actualType || "none"}`);
  }
  if (Boolean(actual.required) !== Boolean(expected.required)) {
    issues.push(
      `${label}: must be ${expected.required ? "required" : "optional"} after replay`
    );
  }
  if (expected.options?.max !== undefined && liveBound(actual, "max") !== expected.options.max) {
    issues.push(`${label}: text/field max must be ${expected.options.max} after replay`);
  }
  if (expected.options?.min !== undefined && liveBound(actual, "min") !== expected.options.min) {
    issues.push(`${label}: field min must be ${expected.options.min} after replay`);
  }
  if (expected.type === "select" && expected.options?.values) {
    if (!sameValueSet(liveValues(actual), expected.options.values)) {
      issues.push(`${label}: select values must match the seed contract after replay`);
    }
  }
  if (expected.type === "autodate") {
    if (actual.onCreate !== true) {
      issues.push(`${label}: autodate onCreate must be true after replay`);
    }
    if ((actual.onUpdate === true) !== (expected.options?.onUpdate === true)) {
      issues.push(`${label}: autodate onUpdate must match the seed contract after replay`);
    }
  }
}

function assertReplayState(live: LiveCollection[]): void {
  const issues: string[] = [];
  const liveByName = new Map(live.map((entry) => [String(entry.name), entry]));

  if (!existsSync(resolve(MIGRATIONS_DIR, TERMINAL_MIGRATION_FILE))) {
    issues.push(
      `terminal migration ${TERMINAL_MIGRATION_FILE} is missing from ${MIGRATIONS_DIR}`
    );
  }

  for (const collection of live.filter((entry) => entry.system !== true)) {
    const name = String(collection.name);
    for (const rule of RULE_NAMES) {
      if (collection[rule] !== null) {
        issues.push(`${name}.${rule} must be null, replayed ${describeRule(collection[rule])}`);
      }
    }
  }

  for (const name of REPLAY_SCHEMA_COLLECTIONS) {
    const collection = liveByName.get(name);
    if (!collection) {
      issues.push(`missing collection after replay: ${name}`);
      continue;
    }
    const liveFields = new Map(
      ((collection.fields as LiveField[] | undefined) ?? []).map((field) => [
        String(field.name),
        field,
      ])
    );
    for (const expected of collectionFieldsForSeed(contractFor(name))) {
      fieldIssues(name, expected, liveFields.get(expected.name), issues);
    }
    const replayedIndexNames = new Set(
      ((collection.indexes as unknown[] | undefined) ?? []).map(liveIndexName)
    );
    for (const expected of contractFor(name).indexes ?? []) {
      if (!replayedIndexNames.has(indexName(expected))) {
        issues.push(`${name}: missing index ${indexName(expected)} after replay`);
      }
    }
  }

  const report = issues.length ? issues.join("\n") : "";
  expect(
    issues,
    `the ${REQUIRED_POCKETBASE_VERSION} migration replay is not locked and schema-complete:\n${report.slice(0, MAX_REPORTED_ISSUE_CHARS)}`
  ).toEqual([]);
}

function resolveBinary(): { binary: string; problem: string | null } {
  const configured = process.env.POCKETBASE_BIN?.trim();
  if (!configured) return { binary: "pocketbase", problem: null };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(configured)) {
    return {
      binary: "pocketbase",
      problem: `POCKETBASE_BIN must be a local executable path, never a URL: "${configured}"`,
    };
  }
  return { binary: configured, problem: null };
}

function requireBinaryVersion(binary: string): string | null {
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (probe.error) {
    return `PocketBase binary "${binary}" could not be executed: ${probe.error.message}`;
  }
  if (probe.status !== 0) {
    return `PocketBase binary "${binary}" exited with status ${String(probe.status)} for --version`;
  }
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  const match = output.match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    return `PocketBase binary "${binary}" did not report a parseable version: ${output.trim()}`;
  }
  if (match[1] !== REQUIRED_POCKETBASE_VERSION) {
    return `the migration replay requires PocketBase ${REQUIRED_POCKETBASE_VERSION}; "${binary}" reports ${match[1]}`;
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => {
        if (port > 0) resolvePort(port);
        else rejectPort(new Error("could not reserve an ephemeral port for the replay server"));
      });
    });
  });
}

function tailOutput(value: string | undefined, lines = MAX_CAPTURED_LOG_LINES): string {
  return (value ?? "").trim().split("\n").slice(-lines).join("\n");
}

function createSuperuser(binary: string, dataDir: string): { email: string; password: string } {
  const email = `pb-replay-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const created = spawnSync(binary, ["superuser", "create", email, password, "--dir", dataDir], {
    encoding: "utf8",
  });
  if (created.status !== 0) {
    throw new Error(
      `could not create the throwaway local superuser: ${created.error?.message ?? `status ${String(created.status)}`}\n${tailOutput(created.stderr)}`
    );
  }
  return { email, password };
}

async function waitForHealth(
  baseUrl: string,
  child: ReplayServer,
  logTail: () => string
): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError = "no response yet";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `the replay server exited before becoming healthy: ${logTail()}`
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        await response.text();
        return;
      }
      lastError = `status ${String(response.status)}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((sleep) => setTimeout(sleep, HEALTH_POLL_MS));
  }
  throw new Error(
    `the replay server never became healthy at ${baseUrl} (${lastError}): ${logTail()}`
  );
}

async function stopServer(child: ReplayServer | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_GRACE_MS);
  await exited;
  clearTimeout(timer);
}

async function replayTerminalMigration(): Promise<void> {
  const { binary, problem: binaryProblem } = resolveBinary();
  expect(
    binaryProblem,
    "the replay never targets a running PocketBase; POCKETBASE_BIN must be a local executable path"
  ).toBeNull();
  const versionProblem = requireBinaryVersion(binary);
  expect(
    versionProblem,
    `PB_MIGRATION_REPLAY=1 fails instead of skipping when the binary is absent or the wrong version`
  ).toBeNull();

  const tempRoot = mkdtempSync(join(tmpdir(), "pb-migration-replay-"));
  const dataDir = join(tempRoot, "pb_data");
  let server: ReplayServer | null = null;
  try {
    const migrated = spawnSync(
      binary,
      ["migrate", "up", "--dir", dataDir, "--migrationsDir", MIGRATIONS_DIR],
      { encoding: "utf8" }
    );
    if (migrated.status !== 0) {
      throw new Error(
        `the full migration chain did not apply: ${migrated.error?.message ?? `status ${String(migrated.status)}`}\n${tailOutput(migrated.stderr)}`
      );
    }

    const { email, password } = createSuperuser(binary, dataDir);

    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    expect(
      new URL(baseUrl).hostname,
      "the replay must only ever talk to its own loopback server"
    ).toBe("127.0.0.1");

    const captured: string[] = [];
    server = spawn(
      binary,
      ["serve", `--http=127.0.0.1:${port}`, "--dir", dataDir, "--migrationsDir", MIGRATIONS_DIR],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const capture = (chunk: Buffer) => {
      captured.push(chunk.toString("utf8"));
      if (captured.length > MAX_CAPTURED_LOG_LINES) captured.shift();
    };
    server.stdout.on("data", capture);
    server.stderr.on("data", capture);
    const logTail = () => tailOutput(captured.join(""));

    await waitForHealth(baseUrl, server, logTail);

    const pb = new PocketBase(baseUrl);
    await pb.collection("_superusers").authWithPassword(email, password);
    const live = (await pb.collections.getFullList()) as unknown as LiveCollection[];

    assertReplayState(live);
  } finally {
    await stopServer(server);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe.runIf(process.env.PB_MIGRATION_REPLAY === "1")(
  "PocketBase terminal migration replay",
  () => {
    it(
      "replays the complete migration chain locked",
      async () => {
        await replayTerminalMigration();
      },
      HEALTH_TIMEOUT_MS * 2
    );
  }
);
