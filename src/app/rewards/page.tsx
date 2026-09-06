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
      <PageShell>
        <div className="px-4 pt-8 pb-8">
          <Surface variant="warm" radius="2xl" padding="lg">
            <div className="text-center py-8">
              <span className="text-5xl block mb-3">🏪</span>
              <h1 className="text-lg font-bold text-text-primary">This is the kids&apos; rewards shop</h1>
              <p className="text-sm text-text-secondary mt-2 max-w-xs mx-auto">
                Kids spend their quest points here. Grown-ups set the rewards up on the Tasks page.
              </p>
              <Link
                href="/tasks"
                className="tap-sm mt-5 inline-block rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-text-primary"
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
