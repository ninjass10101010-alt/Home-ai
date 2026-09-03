// Honest toast copy for the meal-creation paths that go through saveOrQueue.
// saveOrQueue returns false when the PB write failed (401-swallowed by the
// gateway client) and the meal only landed on this device's cache — the toast
// must say so instead of a fake "✅ added".
export function mealSaveToast(saved: boolean, name: string, verb: string): string {
  return saved
    ? `✅ "${name}" ${verb}`
    : `⚠️ "${name}" ${verb} — saved on this device — will sync automatically`;;
}
