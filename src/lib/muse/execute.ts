// MUSE tool catalog + guarded execution (Task 9 / B3).
//
// MUSE gets "full adult parity" with the dashboard assistant, but the tool
// surface is session-agnostic: the catalog is exactly what the parent chat
// surface exposes (`buildToolsForOpenAI({ houseControl: true, role: "parent" })`),
// minus the five destructive/admin tools unless the caller's token is admin.
//
// `executeMuseTool` mirrors the chat route's `runToolCalls` discipline: the
// allowlist is checked FIRST, so a prompt-injected or crafted tool name can
// never reach `getTool` (which searches the FULL registry) unless it is in the
// caller's catalog. A handler throw is converted into an honest 500 result and
// never escapes into the request.

import { buildToolsForOpenAI, getTool } from "@/lib/hermes-tools";

/** Destructive dashboard-management tools — admin tokens only. */
export const ADMIN_TOOLS: ReadonlySet<string> = new Set([
  "check_for_update",
  "trigger_update",
  "get_container_status",
  "restart_container",
  "check_pocketbase",
]);

export type MuseToolCatalogEntry = ReturnType<typeof buildToolsForOpenAI>[number];

/**
 * The session-agnostic adult toolset. Returns the OpenAI-shape entries
 * (`{ type: "function", function: { name, description, parameters } }`).
 * Admin tools are included only when `admin` is true.
 */
export function museToolCatalog(admin: boolean): MuseToolCatalogEntry[] {
  return buildToolsForOpenAI({ houseControl: true, role: "parent" }).filter(
    (t) => admin || !ADMIN_TOOLS.has(t.function.name)
  );
}

export type ExecuteMuseToolResult =
  | { result: unknown }
  | { error: string; status: number };

/**
 * Execute one tool through the real registry, guarded by the caller's
 * allowlist. Returns `{ result }` on success (the handler's parsed JSON when
 * parseable, else the raw string) or `{ error, status }` on rejection/failure.
 */
export async function executeMuseTool(
  name: string,
  args: Record<string, unknown>,
  opts: { admin: boolean }
): Promise<ExecuteMuseToolResult> {
  const allowedNames = new Set(museToolCatalog(opts.admin).map((t) => t.function.name));

  // Allowlist first. When the name is not permitted, distinguish "not a tool
  // at all" (400) from "not permitted" (403) using the full registry catalog
  // WITHOUT consulting getTool — an admin tool named by a non-admin caller
  // must never reach the registry.
  if (!allowedNames.has(name)) {
    const known = museToolCatalog(true).some((t) => t.function.name === name);
    return known
      ? { error: "tool not allowed", status: 403 }
      : { error: "unknown tool", status: 400 };
  }

  const tool = getTool(name);
  if (!tool) return { error: "unknown tool", status: 400 };

  try {
    const raw = await tool.handler(args ?? {});
    try {
      return { result: JSON.parse(raw) };
    } catch {
      return { result: raw };
    }
  } catch (e: any) {
    return { error: e?.message || "Tool failed", status: 500 };
  }
}
