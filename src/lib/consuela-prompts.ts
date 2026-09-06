import { localDateContext } from "@/lib/local-date";
import { AI_BOOT } from "@/lib/ai-boot.generated";

export const CLEM_SYSTEM_PROMPT =
  "You are Clem, a smart grocery shopping assistant for the Garcia family. You know their grocery list and stores. Help them decide what to buy, compare prices, and order via Instacart. Keep responses short and helpful.";

// ── Boot-file composition (2026-09-06) ─────────────────────────────────
// The persona now lives in version-controlled agent files — ai/SOUL.md,
// ai/IDENTITY.md, ai/TOOLS.md, ai/KID.md — exactly like a Hermes profile
// loads its boot files at startup. scripts/write-ai-boot.mjs embeds them at
// prebuild into ai-boot.generated.ts (missing files or kid-toolset drift
// fail the build). Hermes layers our system message ON TOP of its own
// profile soul, so the dashboard owns its identity end-to-end here.
//
// Kept exports for compatibility: SYSTEM_PROMPT / KID_SYSTEM_PROMPT are the
// composed boot strings; buildConsuelaSystemPrompt / buildKidSystemPrompt
// keep their exact call signatures.

export const SYSTEM_PROMPT = [AI_BOOT.SOUL_MD, AI_BOOT.IDENTITY_MD, AI_BOOT.TOOLS_MD].join("\n\n---\n\n");

export const HOUSE_CONTROL_PROMPT_ADDENDUM = `

House control — you can also control smart home devices:
- ha_list_devices: List controllable lights, switches, scenes, thermostats, media players, and vacuums.
- ha_control_device: Control a device by entity_id and action (toggle/turn_on/turn_off, set_temperature, set_hvac_mode, volume_set, media_play/pause, vacuum start/pause/stop/return_to_base).
Never control devices unless the user clearly asks. Alarms and locks are permanently excluded for safety.`;

// KID SOUL — a child session gets this voice, never the adult SYSTEM_PROMPT.
// Scope (user-locked 2026-09-06): friendly helper for dashboard questions +
// summaries only, plus learning (recipes, kid categories, new skills). No
// internet. No chat writes — kids act through the real UI where the PIN /
// pending-approval gates live. Content = ai/KID.md.
export const KID_SYSTEM_PROMPT = AI_BOOT.KID_MD;

export function buildDateContextBlock(now: Date = new Date(), opts?: { kid?: boolean }): string {
  const ctx = localDateContext(now);
  // The add_meal instruction is adult-only — kids have no write tools, so the
  // kid variant stays neutral (their meal logs happen through the real UI).
  const mealLine = opts?.kid
    ? "When they talk about what they ate or dinner plans, use the correct day."
    : "When the user says what they ate or wants planned, use the add_meal tool with the correct day.";
  return `

Current date — use this for "today", "yesterday", "tomorrow" (do NOT guess from server time):
Today is ${ctx.todayWeekday}, ${ctx.todayISO} (${ctx.tz}).
Yesterday was ${ctx.yesterdayWeekday}, ${ctx.yesterdayISO}.
The week runs Monday–Sunday; this week's Monday is ${ctx.weekStartISO}.
${mealLine}`;
}

export function buildConsuelaSystemPrompt(now?: Date): string {
  return SYSTEM_PROMPT + buildDateContextBlock(now);
}

export function buildClemSystemPrompt(now?: Date): string {
  return CLEM_SYSTEM_PROMPT + buildDateContextBlock(now);
}

export function buildKidSystemPrompt(now?: Date, memberName?: string): string {
  const greeting = memberName ? `\nYou are talking with ${memberName} today.` : "";
  return KID_SYSTEM_PROMPT + greeting + buildDateContextBlock(now, { kid: true });
}
