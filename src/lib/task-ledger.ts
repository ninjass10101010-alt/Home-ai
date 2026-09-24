import type { Transaction } from "@/types/tasks";

export function recomputeWeekPoints(history: Transaction[]): Record<string, number> {
  const points: Record<string, number> = {};

  for (const transaction of history) {
    if (!transaction?.member || !Number.isFinite(transaction.amount)) continue;
    const current = points[transaction.member] ?? 0;
    const next = current + transaction.amount;
    points[transaction.member] = next < 0 ? 0 : next;
  }

  return points;
}

export function hasUnreversedTaskEarn(
  history: Transaction[],
  taskId: number,
  member: string,
): boolean {
  const earns = history.filter(
    (transaction) =>
      transaction.type === "earn" &&
      Number(transaction.taskId) === Number(taskId) &&
      transaction.member === member,
  );
  const latestEarn = earns.reduce<Transaction | null>((latest, transaction) => {
    if (!latest) return transaction;
    return String(transaction.timestamp).localeCompare(String(latest.timestamp)) >= 0
      ? transaction
      : latest;
  }, null);
  if (!latestEarn) return false;

  return !history.some(
    (transaction) =>
      transaction.type === "adjust" &&
      transaction.amount < 0 &&
      Number(transaction.taskId) === Number(taskId) &&
      transaction.member === member &&
      String(transaction.timestamp).localeCompare(String(latestEarn.timestamp)) >= 0,
  );
}
