"use client";

import { useEffect } from "react";
import Link from "next/link";
import ErrorState from "@/components/ui/ErrorState";

/**
 * Route-level error boundary (audit P0-4, phase 2).
 *
 * Scope note so nobody over-trusts this file: `error.tsx` catches errors thrown
 * while *rendering* a route segment. It does not catch a failing `fetch` whose
 * promise was swallowed by a no-op catch, and it does not catch anything thrown
 * by the providers in `layout.tsx` (that is `global-error.tsx`). Before this
 * file existed, a render throw unmounted the screen into Next's built-in
 * full-screen error, which on a wall display looks exactly like the app dying.
 *
 * Deliberately provider-free (no `useAuth`, no `PageShell`): if a provider is
 * what broke, this boundary still has to render.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The family sees human copy; the console keeps the stack, and `digest` is
    // what ties a wall-screen complaint back to a server log line.
    console.error("[app-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <div
      className="min-h-screen bg-[var(--color-canvas)] max-w-lg md:max-w-3xl lg:max-w-none mx-auto px-4 pt-16 pb-10"
      data-testid="route-error"
    >
      <ErrorState
        title="This screen hit a snag"
        description="Consuela could not draw this page. Your family data is untouched — try again, or head back to Home and come back."
        retryLabel="Try again"
        onRetry={reset}
      />
      <div className="mt-4 flex flex-col items-center gap-2">
        <Link
          href="/"
          className="hit-44 tap inline-flex min-h-11 items-center rounded-2xl px-4 text-sm font-semibold text-[var(--color-accent-button)] underline underline-offset-2"
        >
          Back to Home
        </Link>
        {error.digest && (
          <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
            {/* Rendered, not only logged: quoting this digest is how a family
                member reports a wall-screen problem without opening dev tools. */}
            If this keeps happening, tell Consuela this code:{" "}
            <code className="font-mono">{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
