import { withKeyedLock } from "@/lib/keyed-lock";

export type TaskCommandLockKey = number | "allocation";

export function withTaskCommandLock<T>(
  key: TaskCommandLockKey,
  fn: () => Promise<T>,
): Promise<T> {
  return withKeyedLock(`task-command:${key}`, fn);
}
