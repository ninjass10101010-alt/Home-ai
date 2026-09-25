import { withKeyedLock } from "@/lib/keyed-lock";

const OPERATION_KEY = "google-integration-operation";
let generation = 0;

export function getGoogleIntegrationGeneration(): number {
  return generation;
}

export function invalidateGoogleIntegrationOperation(): void {
  generation += 1;
}

export function isGoogleIntegrationGenerationCurrent(candidate: number): boolean {
  return candidate === generation;
}

export function withGoogleIntegrationOperation<T>(fn: () => Promise<T>): Promise<T> {
  return withKeyedLock(OPERATION_KEY, fn);
}

export function __resetGoogleIntegrationOperationForTests(): void {
  generation = 0;
}
