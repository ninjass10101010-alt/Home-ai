#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  const hash = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const message = execSync('git log -1 --format="%s"', { encoding: "utf8" }).trim();
  const date = execSync('git log -1 --format="%ci"', { encoding: "utf8" }).trim();
  const author = execSync('git log -1 --format="%an"', { encoding: "utf8" }).trim();
  const info = { hash, message, date, author };
  const outPath = path.join(__dirname, "..", "public", "version.json");
  fs.writeFileSync(outPath, JSON.stringify(info, null, 2));
  console.log(`version.json written: ${hash.substring(0, 7)} — ${message}`);
} catch (e) {
  console.warn("version.json skipped (git not available):", e.message);
}
