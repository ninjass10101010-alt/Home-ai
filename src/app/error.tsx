"use client";

import { Component, type ReactNode, useEffect } from "react";
import Link from "next/link";
import ErrorState from "@/components/ui/ErrorState";
import PageShell from "@/components/ui/PageShell";

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
 * It renders through `PageShell`, so the dock survives: a boundary that replaces
 * a route but drops the shell strands the family with no way out except the
 * browser's own back button — the exact dead end
 * `tests/unit/route-shell-contract.test.ts` forbids. The shell is wrapped in
 * `ShellOrFallback` because the realistic throw *is* the chrome: a dock or auth
 * bug must not turn a recoverable page error into a blank screen with no dock
 * and no copy. `global-error.tsx` covers provider failures and cannot render a
 * shell at all (Next replaces the root layout there).
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

  const copy = (
    <div
      className="max-w-lg md:max-w-3xl lg:max-w-none mx-auto px-4 pt-16 pb-10"
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

  return (
    <ShellOrFallback fallback={copy}>
      <PageShell>{copy}</PageShell>
    </ShellOrFallback>
  );
}

interface ShellOrFallbackProps {
  children: ReactNode;
  /** Rendered instead when the shell itself throws. */
  fallback: ReactNode;
}

/**
 * Renders `children` unless *it* throws. `getDerivedStateFromError` is the only
 * legal place for this: a throw while rendering the shell is exactly the case
 * that must not take the family's only way out down with it.
 */
class ShellOrFallback extends Component<ShellOrFallbackProps, { shellFailed: boolean }> {
  state = { shellFailed: false };

  static getDerivedStateFromError() {
    return { shellFailed: true };
  }

  render() {
    return this.state.shellFailed ? this.props.fallback : this.props.children;
  }
}
