// Usage: npx tsx scripts/consuela/reconcile-pending-approvals.mjs
// Prints one JSON line of repair categories (for example week_mismatch or
// projection:read) and never echoes store contents or raw error messages.
const envPath = new URL("../../.env.local", import.meta.url).pathname;
try { process.loadEnvFile(envPath); } catch {}

const categoryPattern = /^(?:approval|projection|rollover|snapshot|week|week_archive|task)(?:[:_][a-z0-9_-]+){1,2}$/i;
const categories = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && categoryPattern.test(value)))];

try {
  const { reconcileTaskProjection } = await import("../../src/lib/task-projection-reconciler");
  const result = await reconcileTaskProjection();
  const output = {
    ok: result.ok,
    reconciled: result.reconciled,
    repaired: categories(result.repaired),
    failed: categories(result.failed),
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
  }));
  process.exitCode = 1;
}
