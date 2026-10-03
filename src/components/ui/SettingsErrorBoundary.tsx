"use client";

import Link from "next/link";
import React from "react";
import PageShell from "./PageShell";

interface SettingsErrorBoundaryProps {
  children: React.ReactNode;
}

interface SettingsErrorBoundaryState {
  hasError: boolean;
}

class SettingsErrorBoundary extends React.Component<SettingsErrorBoundaryProps, SettingsErrorBoundaryState> {
  state: SettingsErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  private reset = () => {
    this.setState({ hasError: false });
  };

  /**
   * The fallback renders through `PageShell` on purpose. This boundary sits in
   * `settings/layout.tsx`, so when it trips it replaces the whole subtree —
   * including the `PageShell` that `SettingsSectionView` would have supplied —
   * and a fallback without one leaves a parent in Settings with no dock and no
   * way to leave except the browser back button. `tests/unit/route-shell-contract.test.ts`
   * walks `settings/layout.tsx` for that reason.
   */
  render() {
    if (this.state.hasError) {
      return (
        <PageShell>
          <section aria-labelledby="settings-error-heading" data-settings-surface="true" data-settings-content="true" className="p-4">
            <div role="alert" className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/45 p-6 text-center">
              <h1 id="settings-error-heading" className="text-lg font-bold text-text-primary">Settings needs a quick reset</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
                This Settings view could not load. Try again, return to the Settings home, or use the dock below to go somewhere that still works.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={this.reset}
                  className="inline-flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--color-accent-selected)]/20 bg-[var(--color-accent-button)] px-5 text-sm font-semibold text-white tap"
                >
                  Try again
                </button>
                <Link
                  href="/settings"
                  className="inline-flex min-h-[64px] items-center justify-center rounded-2xl border border-white/10 px-5 text-sm font-semibold text-text-secondary tap hover:text-text-primary"
                >
                  Back to Settings
                </Link>
              </div>
            </div>
          </section>
        </PageShell>
      );
    }
    return this.props.children;
  }
}

export default SettingsErrorBoundary;
