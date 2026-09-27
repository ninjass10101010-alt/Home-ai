import Link from "next/link";
import PageShell from "@/components/ui/PageShell";

/**
 * Route-level not-found (audit P0-4, phase 2).
 *
 * `settings/not-found.tsx` already existed; the app simply had no answer for any
 * other unknown URL, so a mistyped or stale link fell through to a bare screen.
 * Honesty has a fourth state besides loading/empty/offline/error — "there is
 * nothing at this address" — and on a wall display where links are hand-typed on
 * a phone, it needs the same plain-language treatment as the others.
 */
export default function NotFound() {
  return (
    <PageShell>
      <section className="px-4 pt-16 pb-10" aria-labelledby="not-found-heading">
        <div
          className="mx-auto max-w-md rounded-3xl border p-8 text-center backdrop-blur-xl"
          style={{
            borderColor: "color-mix(in srgb, var(--color-accent-amber) 30%, transparent)",
            background: "color-mix(in srgb, var(--color-accent-amber) 8%, transparent)",
          }}
          data-testid="route-not-found"
        >
          <div className="mb-4 text-4xl" aria-hidden="true">
            🧭
          </div>
          <h1 id="not-found-heading" className="text-lg font-semibold text-text-primary">
            Nothing lives here
          </h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            That address is not a screen Consuela knows. Nothing is broken — head back to Home and pick a tab.
          </p>
          <Link
            href="/"
            className="hit-44 tap mt-5 inline-flex min-h-11 items-center rounded-2xl bg-[var(--color-accent-button)] px-5 text-sm font-semibold text-white"
          >
            Back to Home
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
