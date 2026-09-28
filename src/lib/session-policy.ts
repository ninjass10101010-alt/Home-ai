// The session VOCABULARY, shared by the db-gateway write policy and the live
// session gate. The session LIFETIME is NOT here: it is `SESSION_TTL_SECONDS` in
// src/lib/session.ts. A per-role TTL table was part of the withheld Wave 2 (the
// role-aware-lifetime + `POST /api/auth/touch` leg never shipped), so shipping
// one would advertise a policy the running app does not enforce.
export const SESSION_ROLES = ["parent", "child", "pet"] as const;

export type SessionRole = (typeof SESSION_ROLES)[number];

export interface SessionIdentity {
  memberId: string;
  name: string;
  role: SessionRole;
}

export function isSessionRole(value: unknown): value is SessionRole {
  return SESSION_ROLES.includes(value as SessionRole);
}
