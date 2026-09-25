const envPath = new URL("../../.env.local", import.meta.url).pathname;
try { process.loadEnvFile(envPath); } catch {}

const categoryPattern = /^(?:approval|projection|rollover|snapshot|week|task):[a-z0-9_-]+(?::[a-z0-9_-]+)?$/i;
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
} catch {
  console.log(JSON.stringify({
    ok: false,
    reconciled: false,
    repaired: [],
    failed: ["projection:unavailable"],
  }));
  process.exitCode = 1;
}
