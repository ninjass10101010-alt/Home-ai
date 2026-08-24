// Shared bearer-token gate for host-crontab routes (POST /api/cron/**).
//
// Fails closed: when CRON_SECRET is unset, NOTHING authenticates — not even
// the literal string "Bearer undefined" that a naive template comparison
// would accept. Every cron route must use this helper instead of comparing
// against `Bearer ${process.env.CRON_SECRET}` inline.

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
