#!/usr/bin/env node
/**
 * Refuses to run verification unless PocketBase resolves to a LOCAL host.
 * src/lib/pb.ts falls back to http://192.168.0.28:8090 (the live family
 * database) when NEXT_PUBLIC_PB_URL is unset — this guard makes that
 * impossible to do by accident.
 */
const LIVE_MARKERS = ["192.168.0.28", "jeff-nas"];
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "pocketbase"];

const url = process.env.NEXT_PUBLIC_PB_URL || "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  console.error(`\n✖ NEXT_PUBLIC_PB_URL is not a URL: ${JSON.stringify(url)}\n`);
  console.error("Set it explicitly before running verification:");
  console.error("  export NEXT_PUBLIC_PB_URL=http://localhost:8090\n");
  process.exit(1);
}

if (LIVE_MARKERS.some((m) => host.includes(m))) {
  console.error(`\n✖ REFUSING TO RUN: NEXT_PUBLIC_PB_URL points at the LIVE NAS (${host}).\n`);
  console.error("Verification must never write to the family database.\n");
  process.exit(1);
}

if (!LOCAL_HOSTS.includes(host)) {
  console.error(`\n✖ REFUSING TO RUN: host ${host} is not an approved local target.\n`);
  console.error(`Approved: ${LOCAL_HOSTS.join(", ")}\n`);
  process.exit(1);
}

console.log(`✔ PocketBase target is LOCAL: ${url}`);
