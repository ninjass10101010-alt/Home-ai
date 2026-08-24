// Allowlist of Home Assistant services callable through POST /api/ha/call-service.
//
// This is the network boundary for unauthenticated House-tab traffic, so it is
// deliberately narrower than what Home Assistant offers: only the convenience
// domains the dashboard UI actually controls, with an explicit service matrix
// per domain. Anything not listed here — locks, scripts, automations,
// shell_command, notify.*, cover, media_player, and ALL alarm control — is
// rejected with 403 before it ever reaches the HA WebSocket client.
//
// Arm/disarm is intentionally NOT on this list: security actions are
// human-only and PIN-gated via POST /api/ha/alarm (server-side PIN
// verification against family members). The LLM/chat tool layer never
// receives an alarm tool either.
//
// Internal server-side callers (grocery→todo mirror, house-alert notifications)
// use getHAWebSocketClient().callService() directly and intentionally bypass
// this list — they are trusted code, not reachable over HTTP.

export const HA_ROUTE_ALLOWED_SERVICES: ReadonlyMap<string, ReadonlySet<string>> =
  new Map([
    ["light", new Set(["toggle", "turn_on", "turn_off"])],
    ["switch", new Set(["toggle", "turn_on", "turn_off"])],
    ["climate", new Set(["set_temperature", "set_hvac_mode"])],
    ["vacuum", new Set(["start", "pause", "stop", "return_to_base"])],
  ]);

export function isHAServiceAllowed(domain: string, service: string): boolean {
  return (
    HA_ROUTE_ALLOWED_SERVICES.get(domain.trim().toLowerCase())?.has(
      service.trim().toLowerCase()
    ) ?? false
  );
}
