"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import PageHeader from "@/components/patterns/PageHeader";
import PageShell from "@/components/ui/PageShell";
import { useAuth } from "@/hooks/useAuth";
import {
  SETTINGS_SECTIONS,
  settingsSectionsForRole,
  type SettingsRole,
  type SettingsSectionId,
} from "@/lib/settings-sections";

export interface SettingsSectionViewProps {
  section: SettingsSectionId;
  children: ReactNode;
}

export default function SettingsSectionView({ section, children }: SettingsSectionViewProps) {
  const { currentUser, hydrated } = useAuth();
  const definition = SETTINGS_SECTIONS.find((item) => item.id === section);
  const role: SettingsRole = currentUser?.role ?? "guest";
  const availableSections = settingsSectionsForRole(role);
  const isAvailable = definition ? availableSections.some((item) => item.id === definition.id) : false;

  if (!hydrated) {
    return (
      <PageShell>
        <div data-settings-surface="true" data-settings-content="true" data-settings-hydrated="false" aria-busy="true">
          <PageHeader title="Settings" backHref="/settings" backLabel="Back to Settings" icon="⚙️" />
          <section className="px-4 pb-8" aria-labelledby="settings-hydration-heading">
            <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/35 p-6">
              <h2 id="settings-hydration-heading" className="text-lg font-bold text-text-primary">
                Checking your settings
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">One moment while we confirm who is using this screen.</p>
            </div>
          </section>
        </div>
      </PageShell>
    );
  }

  if (!definition || !isAvailable) {
    return (
      <PageShell>
        <div data-settings-surface="true" data-settings-content="true" data-settings-hydrated="true" data-settings-role={role}>
          <PageHeader title="Settings" backHref="/settings" backLabel="Back to Settings" icon="⚙️" />
          <section className="px-4 pb-8" aria-labelledby="settings-unavailable-heading">
            <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/35 p-6">
              <h2 id="settings-unavailable-heading" className="text-lg font-bold text-text-primary">
                This section is not available
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">Choose a section from Settings to continue.</p>
            </div>
          </section>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div data-settings-surface="true" data-settings-content="true" data-settings-hydrated="true" data-settings-role={role} data-section={definition.id}>
        <PageHeader
          title={definition.title}
          subtitle={definition.description}
          backHref="/settings"
          backLabel="Back to Settings"
          icon={definition.icon}
        />
        <div className="space-y-6 px-4 pb-8">
          {children}
          <nav aria-label="Settings sections" className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/25 p-4">
            <h2 className="px-2 text-sm font-bold text-text-primary">All available sections</h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {availableSections.map((item) => (
                <li key={item.id}>
                  <Link
                     href={`/settings/${item.id}`}
                     prefetch={false}
                     aria-current={item.id === definition.id ? "page" : undefined}
                    className={`tap flex min-h-[44px] items-center justify-between rounded-2xl border px-4 text-sm font-semibold ${
                      item.id === definition.id
                        ? "border-[var(--color-accent-selected)]/30 bg-[var(--color-accent-selected)]/10 text-text-primary"
                        : "border-white/10 text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    <span>{item.title}</span>
                    <span aria-hidden="true">{item.id === definition.id ? "•" : "›"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </PageShell>
  );
}
