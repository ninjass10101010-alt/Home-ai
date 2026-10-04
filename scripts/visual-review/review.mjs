#!/usr/bin/env node
// CLI for the visual-review harness.
//
//   node scripts/visual-review/review.mjs --route / --role parent --viewport phone
//   node scripts/visual-review/review.mjs --route / --viewport phone,laptop,wall --theme dark,light
//
// Prints a JSON report to stdout and writes screenshots under --out.
// Exit code 0 = every check clean; 1 = at least one error-severity finding.

import { runReviews, ROLES, VIEWPORTS } from "./harness.mjs";

function parseArgs(argv) {
  const args = { route: "/", role: "parent", viewport: "phone", theme: "", tod: "", out: "/tmp/warmglass/shots", settle: 1200 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--route") { args.route = value; i += 1; }
    else if (key === "--role") { args.role = value; i += 1; }
    else if (key === "--viewport") { args.viewport = value; i += 1; }
    else if (key === "--theme") { args.theme = value; i += 1; }
    else if (key === "--tod") { args.tod = value; i += 1; }
    else if (key === "--out") { args.out = value; i += 1; }
    else if (key === "--settle") { args.settle = Number(value); i += 1; }
    else if (key === "--help") { args.help = true; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/visual-review/review.mjs [options]
  --route <path>        route to review (default /)
  --role <r>            ${ROLES.join(" | ")} (default parent)
  --viewport <v>        ${Object.keys(VIEWPORTS).join(" | ")} (comma-separated ok)
  --theme <t>           dark | light | dark,light — comma-separated ok
  --tod <t>             day | night | day,night — pins <html data-timeofday>, the
                        atmosphere layer's clock seam (default: the real clock)
  --out <dir>           screenshot dir (default /tmp/warmglass/shots)
  --settle <ms>         post-load settle time (default 1200)`);
  process.exit(0);
}

const viewports = args.viewport.split(",").map((s) => s.trim()).filter(Boolean);
const roles = args.role.split(",").map((s) => s.trim()).filter(Boolean);
const themes = args.theme ? args.theme.split(",").map((s) => s.trim()).filter(Boolean) : [undefined];
const tods = args.tod ? args.tod.split(",").map((s) => s.trim()).filter(Boolean) : [undefined];

for (const v of viewports) {
  if (!VIEWPORTS[v]) { console.error(`Unknown viewport: ${v}`); process.exit(2); }
}
for (const r of roles) {
  if (!ROLES.includes(r)) { console.error(`Unknown role: ${r}`); process.exit(2); }
}
for (const t of tods) {
  if (t !== undefined && t !== "day" && t !== "night") { console.error(`Unknown --tod: ${t}`); process.exit(2); }
}

const targets = [];
for (const role of roles) {
  for (const viewport of viewports) {
    for (const theme of themes) {
      for (const timeOfDay of tods) targets.push({ route: args.route, role, viewport, themeMode: theme, timeOfDay });
    }
  }
}

const { reports } = await runReviews(targets, { outDir: args.out, settleMs: args.settle });

let errorCount = 0;
for (const report of reports) {
  const label = `${report.route} [${report.role}/${report.viewport}${report.themeMode !== "(default)" ? `/${report.themeMode}` : ""}${report.timeOfDay !== "(real clock)" ? `/${report.timeOfDay}` : ""}]`;
  console.log(`\n=== ${label} ===`);
  console.log(`screenshot: ${report.screenshot}`);
  if (report.navError) { console.log(`  NAV ERROR: ${report.navError}`); errorCount += 1; }
  for (const e of report.pageErrors) { console.log(`  PAGE ERROR: ${e}`); errorCount += 1; }
  for (const e of report.consoleErrors) { console.log(`  CONSOLE: ${e}`); }
  for (const e of report.failedRequests) console.log(`  REQ FAILED: ${e}`);
  if (report.unstubbed.length) console.log(`  unstubbed APIs (page may be showing an empty/error state): ${report.unstubbed.join(", ")}`);

  const byRule = {};
  for (const p of report.problems) (byRule[p.rule] ??= []).push(p);
  for (const [rule, list] of Object.entries(byRule)) {
    const blocking = list.filter((p) => p.severity === "error");
    if (rule !== "contrast") errorCount += blocking.length;
    const tag = blocking.length ? "ERROR" : "WARN";
    console.log(`  ${tag} ${rule} (${list.length}):`);
    for (const p of list.slice(0, 25)) console.log(`    - ${p.detail}`);
    if (list.length > 25) console.log(`    ...and ${list.length - 25} more`);
  }
  if (report.problems.length === 0) console.log("  CLEAN — no contract violations detected");
}

console.log(`\n=== TOTAL ERROR-SEVERITY FINDINGS: ${errorCount} ===`);
process.exit(errorCount > 0 ? 1 : 0);