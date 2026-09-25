"use client";

import PageHeader from "@/components/patterns/PageHeader";
import PageShell from "@/components/ui/PageShell";
import SettingsLauncher from "@/components/settings/SettingsLauncher";
import { useAuth } from "@/hooks/useAuth";
import { settingsSectionsForRole, type SettingsRole } from "@/lib/settings-sections";

export default function SettingsPage() {
  const { currentUser, hydrated } = useAuth();
  const role: SettingsRole = currentUser?.role ?? "guest";
  const sections = settingsSectionsForRole(role);

  return (
    <PageShell>
      <div data-settings-page="true" data-settings-content="true" data-settings-hydrated={String(hydrated)} data-settings-role={role}>
        <PageHeader
          title="Settings"
          subtitle="Choose what to manage"
          icon="⚙️"
        />
        {hydrated ? (
          <SettingsLauncher sections={sections} />
        ) : (
          <section className="px-4 pb-8" aria-label="Loading settings" aria-busy="true">
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-0)]/35 p-6">
              <h2 className="text-lg font-bold text-text-primary">Checking your settings</h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">One moment while we confirm who is using this screen.</p>
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}
