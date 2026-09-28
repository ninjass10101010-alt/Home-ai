// Usage: npx tsx scripts/consuela/reconcile-pending-approvals.mjs
// Prints one JSON line of repair categories (for example tasks:read,
// tasks:changed, week_mismatch, or projection:read) and never echoes store
// contents or raw error messages.
import { repairCategories } from "../../src/lib/task-repair-categories";

const envPath = new URL("../../.env.local", import.meta.url).pathname;
try { process.loadEnvFile(envPath); } catch {}

try {
  const { reconcileTaskProjection } = await import("../../src/lib/task-projection-reconciler");
  const result = await reconcileTaskProjection();
  const output = {
    ok: result.ok,
    reconciled: result.reconciled,
    repaired: repairCategories(result.repaired),
    failed: repairCategories(result.failed),
    warnings: repairCategories(result.warnings),
  };
  console.log(JSON.stringify(output));
  if (!output.ok || !output.reconciled) process.exitCode = 1;
} catch (error) {
  const category = error && typeof error === "object" && "code" in error && String(error.code) === "ENOTFOUND"
    ? "projection:read"
    : "projection:unavailable";
  console.log(JSON.stringify({
    ok: false,
    reconciled: false,
    repaired: [],
    failed: [category],
    warnings: [],
  }));
  process.exitCode = 1;
}
