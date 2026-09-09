// One-time: populate members.age on live PB rows that lack it (values from
// member-fallback.ts). Run AFTER `npm run pb:seed` adds the field. Safe to
// re-run: rows with a non-null age are skipped.
//
// Imports a .ts file, so run via tsx (same pattern as npm run pb:seed):
//   npx tsx scripts/consuela/set-member-ages.mjs
import PB from "pocketbase";
import { memberFallbacks } from "../../src/lib/member-fallback.ts";

const envPath = new URL("../../.env.local", import.meta.url).pathname;
try { process.loadEnvFile(envPath); } catch {}
const url = process.env.NEXT_PUBLIC_PB_URL || "http://192.168.0.28:8090";
const email = process.env.PB_ADMIN_EMAIL, pass = process.env.PB_ADMIN_PASS;
if (!email || !pass) { console.error("PB_ADMIN_EMAIL/PB_ADMIN_PASS required"); process.exit(1); }

const pb = new PB(url);
await pb.collection("_superusers").authWithPassword(email, pass);
const rows = await pb.collection("members").getFullList({ requestKey: null });
for (const r of rows) {
  if (r.age != null && r.age !== "") { console.log(`skip ${r.name} (age ${r.age})`); continue; }
  const first = String(r.name).split(" ")[0].toLowerCase();
  const fb = memberFallbacks.find((m) => m.name.split(" ")[0].toLowerCase() === first);
  if (!fb) { console.log(`no fallback age for ${r.name} — set it in Settings`); continue; }
  await pb.collection("members").update(r.id, { age: fb.age });
  console.log(`set ${r.name}.age = ${fb.age}`);
}
console.log("done");
