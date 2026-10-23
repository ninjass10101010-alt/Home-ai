"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/patterns/PageHeader";
import PageShell from "@/components/ui/PageShell";
import SettingsLauncher from "@/components/settings/SettingsLauncher";
import { useAuth } from "@/hooks/useAuth";
import { settingsSectionsForRole, type SettingsRole } from "@/lib/settings-sections";

export default function SettingsPage() {
  const { currentUser, hydrated } = useAuth();
  const role: SettingsRole = currentUser?.role ?? "guest";
  const sections = settingsSectionsForRole(role);
  const [googleStatus, setGoogleStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || role !== "parent") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/google/state", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null) as unknown;
        if (!data || typeof data !== "object" || Array.isArray(data)) return;
        const state = data as { connected?: unknown; pending?: unknown };
        if (state.connected === true) {
          setGoogleStatus("Google Calendar connected");
        } else if (state.pending === true) {
          setGoogleStatus("Google Calendar — finish sign-in");
        } else {
          setGoogleStatus(null);
        }
      } catch {
        if (!controller.signal.aborted) setGoogleStatus(null);
      }
    })();
    return () => controller.abort();
  }, [hydrated, role]);

  return (
    <PageShell>
      <div data-settings-page="true" data-settings-content="true" data-settings-hydrated={String(hydrated)} data-settings-role={role}>
        <PageHeader
          title="Settings"
          subtitle="Choose what to manage"
          icon="⚙️"
        />
        {hydrated ? (
          <SettingsLauncher
            sections={sections}
            statusOverrides={role === "parent" && googleStatus ? { system: googleStatus } : undefined}
          />
        ) : (
          <section className="px-4 pb-8" aria-label="Loading settings" aria-busy="true">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-0)]/35 p-6">
              <h2 className="text-lg font-bold text-text-primary">Checking your settings</h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">One moment while we confirm who is using this screen.</p>
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}
