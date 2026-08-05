export function todayMondayISO(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(now);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon.toISOString().split("T")[0];
}

export function weekStartForDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  mon.setHours(0, 0, 0, 0);
  return mon.toISOString().split("T")[0];
}

export function shiftWeek(weekOf: string, deltaWeeks: number): string {
  const d = new Date(weekOf + "T00:00:00");
  d.setDate(d.getDate() + deltaWeeks * 7);
  return d.toISOString().split("T")[0];
}

export function isoDateForWeekday(weekOf: string, weekdayShort: string): string {
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekdayNum = weekdayMap[weekdayShort] ?? 1;
  const d = new Date(weekOf + "T00:00:00");
  d.setDate(d.getDate() + (weekdayNum === 0 ? 6 : weekdayNum - 1));
  return d.toISOString().split("T")[0];
}

export function getMealsForWeek(weekOf: string, allMeals: any[]): any[] {
  return allMeals.filter((m: any) => m.weekOf === weekOf);
}

export function weekLabel(weekOf: string): string {
  const mon = new Date(weekOf + "T00:00:00");
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(mon)}–${fmt(sun)}`;
}
