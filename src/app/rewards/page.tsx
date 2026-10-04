"use client";

import RewardsShop from "@/modes/kid/RewardsShop";
import PageShell from "@/components/ui/PageShell";
import Surface from "@/components/ui/Surface";
import Link from "next/link";
import { useDashboardMode } from "@/hooks/useDashboardMode";

// The shop is the kid experience: a big points balance and tap-to-redeem
// cards mean nothing (and redeem oddly) for a signed-in parent or a guest
// deep-linking in. No redirect — the page stays discoverable; non-kid modes
// get a calm explainer that points at where grown-ups manage rewards.
export default function RewardsPage() {
  const { mode } = useDashboardMode();

  if (mode !== "kid") {
    return (
      // `measure="read"`, deliberately. This page is one card and a sentence for
      // a grown-up who landed here by accident, so the right answer is a short
      // centred page — not a card stretched to the board measure, which is what
      // made it a 1300×320 slab floating in a 1920px wall with 760px of nothing
      // under it. (Rewards is `KID_ROLES` and hidden from the wall anyway; the
      // kid half below is the real surface and brings its own width.)
      <PageShell measure="read">
        {/* Centred in the viewport's short-page band, so on a tall canvas the
            card reads as a deliberate short page rather than as content that
            was abandoned at the top of a mostly-empty screen. */}
        <div className="grid min-h-[70svh] place-items-center px-4 py-8">
          <Surface variant="warm" radius="2xl" padding="lg">
            <div className="text-center py-8">
              <span className="text-5xl block mb-3">🏪</span>
              <h1 className="text-lg font-bold text-text-primary">This is the kids&apos; rewards shop</h1>
              <p className="text-sm text-text-secondary mt-2 max-w-xs mx-auto">
                Kids spend their quest points here. Grown-ups set the rewards up on the Tasks page.
              </p>
              <Link
                href="/tasks"
                /* `hit-44`: the pill renders 129×38, under the house 44px
                   floor on the axis that matters, so the centred ::before box
                   gives it a 44px target without changing the visual size. */
                className="tap-sm hit-44 mt-5 inline-block rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-text-primary"
              >
                Go to Tasks →
              </Link>
            </div>
          </Surface>
        </div>
      </PageShell>
    );
  }

  return <RewardsShop />;
}
