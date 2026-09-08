#!/usr/bin/env node
// Consuela → Obsidian memory mirror (Mac-side pull agent).
// Pulls POST /api/cron/consuela/memory-export (CRON_SECRET bearer) and renders
// one markdown note per memory into the vault. Idempotent: same id → same
// filename → overwrite; deletions in PB are NOT propagated (v1 is one-way;
// a stale note just stays until a future cleanup pass).
//
// Config: ~/.config/consuela/memory-agent.json
//   { "dashboardUrl": "http://<dashboard-host>:3000",
//     "cronSecret": "<CRON_SECRET value>",
//     "vaultDir": "/Users/garciafam/Library/CloudStorage/GoogleDrive-<you>@gmail.com/My Drive/Obsidian Vault/Brain" }
// NEVER commit this file or the secret. chmod 600 the config.
//
// Install (launchd, 15-min cadence):
//   1. Edit the config above.
//   2. cp scripts/obsidian-agent/com.garcia.consuela-memory-agent.plist ~/Library/LaunchAgents/
//      (fix the node + script absolute paths inside the plist first)
//   3. launchctl load ~/Library/LaunchAgents/com.garcia.consuela-memory-agent.plist
//   4. Verify: launchctl list | grep consuela  &&  ls "<vault>/Memory/Consuela"

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { renderNote, notePath, renderIndex } from "./render-notes.mjs";

const CONFIG_PATH = join(homedir(), ".config", "consuela", "memory-agent.json");

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`[consuela-memory-agent] missing config at ${CONFIG_PATH}`);
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  for (const key of ["dashboardUrl", "cronSecret", "vaultDir"]) {
    if (!cfg[key]) {
      console.error(`[consuela-memory-agent] config missing "${key}"`);
      process.exit(1);
    }
  }
  return cfg;
}

async function main() {
  const cfg = loadConfig();
  const res = await fetch(`${cfg.dashboardUrl.replace(/\/+$/, "")}/api/cron/consuela/memory-export`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.cronSecret}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`export endpoint returned ${res.status}`);
  const body = await res.json();
  const memories = Array.isArray(body.memories) ? body.memories : [];

  const root = join(cfg.vaultDir, "Memory", "Consuela");
  mkdirSync(root, { recursive: true });

  const readmePath = join(root, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      "# Consuela Memory\n\nAuto-mirrored one-way from the Consuela dashboard every 15 minutes.\nEdits here are NOT synced back — PocketBase is the source of truth.\nManage memories in the dashboard (Consuela chat, or /memory).\n",
      "utf8"
    );
  }

  let written = 0;
  const byCategory = new Map();
  for (const memory of memories) {
    try {
      const rel = notePath(memory);
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, renderNote(memory), "utf8");
      written += 1;
      const cat = String(memory.category || "note");
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(memory);
    } catch (err) {
      // One bad memory (bad id, unwritable path, …) must not sink the run.
      console.error(`[consuela-memory-agent] warning: skipped memory ${memory?.id ?? "?"} — ${err?.message || err}`);
      continue;
    }
  }
  for (const [cat, list] of byCategory) {
    const abs = join(root, cat, "_index.md");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, renderIndex(cat, list), "utf8");
  }
  console.log(`[consuela-memory-agent] ${new Date().toISOString()} — exported ${body.count ?? memories.length} memories, wrote ${written} of ${memories.length} notes to ${root}`);
}

main().catch((err) => {
  console.error(`[consuela-memory-agent] failed: ${err?.message || err}`);
  process.exit(1);
});
