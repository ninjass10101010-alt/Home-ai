import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const SOURCE_DIR = "/app-source";
const COMPOSE_FILE = path.join(SOURCE_DIR, "docker-compose.yml");
const CONTAINER_NAME = "consuela-dashboard";

interface UpdateLog {
  step: string;
  status: "ok" | "error" | "running";
  detail: string;
  timestamp: string;
}

async function runCmd(cmd: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const result = execSync(cmd, {
        cwd: cwd || SOURCE_DIR,
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      resolve(result.trim());
    } catch (e: any) {
    console.error("[admin/update]", e);
      reject(new Error(e.stderr || e.message || "Command failed"));
    }
  });
}

export async function POST() {
  const logs: UpdateLog[] = [];
  const ts = () => new Date().toISOString();

  const add = (step: string, status: UpdateLog["status"], detail: string) => {
    logs.push({ step, status, detail, timestamp: ts() });
  };

  try {
    add("check-source", "running", "Verifying dashboard source directory...");
    try {
      await runCmd("test -d /app-source/.git && echo exists");
      add("check-source", "ok", "Source directory found with git");
    } catch (e: any) {
    console.error("[admin/update]", e);
      add("check-source", "error", "No .git found in /app-source. Mount the project directory at /app-source.");
      return NextResponse.json({ ok: false, logs, error: "Source directory not mounted" }, { status: 500 });
    }

    add("git-pull", "running", "Pulling latest from warm-glass-v2...");
    try {
      const result = await runCmd("git fetch origin warm-glass-v2 2>/dev/null; git checkout warm-glass-v2 2>/dev/null; git pull origin warm-glass-v2 2>&1");
      add("git-pull", "ok", result || "Already up to date");
    } catch (e: any) {
    console.error("[admin/update]", e);
      add("git-pull", "error", e.message);
      return NextResponse.json({ ok: false, logs, error: "Git pull failed" }, { status: 500 });
    }

    add("env-check", "running", "Checking .env file...");
    try {
      await runCmd("test -f /app-source/.env && echo exists");
      add("env-check", "ok", ".env file found");
    } catch (e: any) {
    console.error("[admin/update]", e);
      try {
        await runCmd("test -f /app-source/.env.docker && echo exists");
        await runCmd("cp /app-source/.env.docker /app-source/.env");
        add("env-check", "ok", "Created .env from .env.docker template (fill in secrets)");
      } catch (e: any) {
    console.error("[admin/update]", e);
        add("env-check", "ok", "No .env or .env.docker — container env vars will be used");
      }
    }

    add("stop", "running", "Stopping container consuela-dashboard...");
    try {
      await runCmd(`docker stop ${CONTAINER_NAME} 2>/dev/null; docker rm ${CONTAINER_NAME} 2>/dev/null; echo "stopped"`);
      add("stop", "ok", "Container stopped");
    } catch (e: any) {
    console.error("[admin/update]", e);
      add("stop", "ok", "Container not running (already stopped)");
    }

    add("build-deploy", "running", "Building and starting new container...");
    try {
      const result = await runCmd(
        `docker compose -f ${COMPOSE_FILE} up -d --build ${CONTAINER_NAME} 2>&1`,
        SOURCE_DIR,
      );
      add("build-deploy", "ok", result || "Container started");
    } catch (e: any) {
    console.error("[admin/update]", e);
      add("build-deploy", "error", e.message);
      return NextResponse.json({ ok: false, logs, error: "Docker build failed" }, { status: 500 });
    }

    add("new-version", "running", "Reading new build version...");
    try {
      const version = await readFile(path.join(process.cwd(), "public", "version.json"), "utf-8");
      const v = JSON.parse(version);
      add("new-version", "ok", `Updated to ${v.short || "unknown"} — ${v.message || ""}`);
    } catch (e: any) {
    console.error("[admin/update]", e);
      add("new-version", "ok", "Version info not available yet (will update after rebuild)");
    }

    return NextResponse.json({
      ok: true,
      logs,
      message: "Dashboard updated successfully. Reloading in 5 seconds...",
    });
  } catch (e: any) {
    console.error("[admin/update]", e);
    add("fatal", "error", e.message);
    return NextResponse.json({ ok: false, logs, error: e.message }, { status: 500 });
  }
}
