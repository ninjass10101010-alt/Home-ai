'use client';

import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import { FamilyMemoryBrowser } from '@/components/analytics/FamilyMemoryBrowser';
import { MEMORY_FAMILY_ID } from '@/lib/memory-ids';

/**
 * The parent-only family memory bank.
 *
 * This page used to render a bare `min-h-screen bg-background` div with no
 * shell, no dock and no back control, while the Home `More…` sheet put "Family
 * Memory" in front of parents — so tapping it landed on a screen with no way out
 * but the browser's own back button. It now goes through `PageShell` like every
 * other route, and the id comes from the canonical namespace module
 * (`memory-ids.ts`: "import these, never re-string them") rather than a literal.
 *
 * Middleware gates `/memory` to a `parent` session and redirects anyone else to
 * `/`, so no in-page role check is needed.
 */
export default function MemoryPage() {
  return (
    <PageShell>
      <div className="px-4 pt-6 pb-6">
        <Link
          href="/"
          className="hit-44 -ml-2 mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[var(--color-accent-selected)] transition-colors hover:bg-[var(--color-accent-selected)]/10"
        >
          <span aria-hidden="true">←</span> Back to Home
        </Link>
        <FamilyMemoryBrowser familyId={MEMORY_FAMILY_ID} />
      </div>
    </PageShell>
  );
}
