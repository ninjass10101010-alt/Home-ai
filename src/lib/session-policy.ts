export const SESSION_ROLES = ["parent", "child", "pet"] as const;

export type SessionRole = (typeof SESSION_ROLES)[number];

export const SESSION_TTL_SECONDS_BY_ROLE = {
  parent: 1800,
  child: 900,
  pet: 900,
} as const;

export interface SessionIdentity {
  memberId: string;
  name: string;
  role: SessionRole;
}

export function isSessionRole(value: unknown): value is SessionRole {
  return SESSION_ROLES.includes(value as SessionRole);
}

export function sessionTtlSeconds(role: SessionRole): number {
  return SESSION_TTL_SECONDS_BY_ROLE[role];
}
