import Skeleton from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton (audit P0-4, phase 2).
 *
 * Before this existed the app had no `loading.tsx` anywhere, so navigation
 * showed the previous screen until the new one was ready. That is the *good*
 * case; the bad case was that a screen which never resolves looks identical to
 * one that is merely slow. `loading.tsx` is what makes "still working" a real,
 * bounded state instead of an assumption — and it is deliberately a skeleton of
 * the frame, not a spinner: a wall display swaps frames, it does not wait.
 */
export default function RouteLoading() {
  return (
    <div
      className="min-h-screen bg-[var(--color-canvas)] px-4 pt-8 pb-16"
      aria-busy="true"
      data-testid="route-loading"
    >
      <span className="sr-only">Loading this screen</span>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton variant="avatar" />
          <div className="flex-1 space-y-2">
            <Skeleton variant="title" className="max-w-52" />
            <Skeleton variant="text" className="max-w-72" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      </div>
    </div>
  );
}
