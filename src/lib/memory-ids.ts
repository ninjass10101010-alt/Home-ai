/**
 * Canonical memory-bank namespace ids. The agent writes rows under
 * userId "consuela" inside familyId "demo-family"; the /memory browser,
 * the export cron, and the adult chat context-builder must all read/write
 * the SAME namespace — import these, never re-string them.
 */
export const MEMORY_USER_ID = "consuela";
export const MEMORY_FAMILY_ID = "demo-family";
