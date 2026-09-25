"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSettingsFeedback } from "@/hooks/useSettingsFeedback";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import AiModelsCard from "@/components/settings/AiModelsCard";
import GoogleConnectCard from "@/components/settings/GoogleConnectCard";
import HaNotificationsCard from "@/components/settings/HaNotificationsCard";
import MuseApiCard from "@/components/settings/MuseApiCard";
import ServicesKeysCard from "@/components/settings/ServicesKeysCard";
import VersionCard from "@/components/settings/VersionCard";
import SectionCard from "@/components/patterns/SectionCard";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import SoftButton from "@/components/ui/SoftButton";
import Toast from "@/components/ui/Toast";

interface PushResult {
  collection: string;
  pushed: number;
  errors: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPushResult(value: unknown): value is PushResult {
  if (!isRecord(value) || typeof value.collection !== "string" || !value.collection) return false;
  return Number.isSafeInteger(value.pushed)
    && Number.isSafeInteger(value.errors)
    && (value.pushed as number) >= 0
    && (value.errors as number) >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEffectiveLayout(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["phone", "tablet", "desktop"].every((mode) => {
    const bucket = value[mode];
    return isRecord(bucket) && isStringArray(bucket.widgets) && isStringArray(bucket.hidden);
  });
}

function sanitizeExportMembers(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) throw new Error("invalid members");
  return value.map((member) => {
    if (!isRecord(member) || typeof member.name !== "string" || !member.name.trim()) {
      throw new Error("invalid member");
    }
    const safe = { ...member };
    delete safe.pin;
    return safe;
  });
}

function sanitizeExportContacts(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("invalid contacts");
  return value.map((contact) => {
    if (
      !isRecord(contact)
      || typeof contact.name !== "string"
      || !contact.name.trim()
      || typeof contact.phone !== "string"
      || typeof contact.email !== "string"
    ) {
      throw new Error("invalid contact");
    }
    return { ...contact };
  });
}

async function readAuthoritativeJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`authoritative read failed: ${response.status}`);
  return body;
}

export default function SystemSettingsSection() {
  const { currentUser, hydrated } = useAuth();
  const { config: liveLayout, mounted: layoutMounted } = useHomeLayout();
  const { feedback, showFeedback } = useSettingsFeedback();
  const [pushOpen, setPushOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pushGuardRef = useRef(false);
  const exportGuardRef = useRef(false);

  if (hydrated !== true) {
    return (
      <section aria-label="Connections and System settings" data-settings-system="true" aria-busy="true" className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/35 p-6">
        <p className="text-sm text-text-secondary">Checking system settings…</p>
      </section>
    );
  }

  if (currentUser?.role !== "parent") return null;

  const exportData = async () => {
    if (exportGuardRef.current) return;
    exportGuardRef.current = true;
    setExporting(true);
    try {
      const [memberBody, contactBody] = await Promise.all([
        readAuthoritativeJson("/api/members/admin?source=live"),
        readAuthoritativeJson("/api/emergency-contacts"),
      ]);
      if (!isRecord(memberBody) || memberBody.source !== "live" || !Array.isArray(memberBody.members)) throw new Error("members are not live");
      if (!isRecord(contactBody) || contactBody.contactsSource !== "live" || !Array.isArray(contactBody.contacts)) {
        throw new Error("contacts are not live");
      }
      if (!layoutMounted || !isEffectiveLayout(liveLayout)) throw new Error("home layout is not ready");
      const payload = {
        members: sanitizeExportMembers(memberBody.members),
        contacts: sanitizeExportContacts(contactBody.contacts),
        layout: liveLayout,
        source: { members: "live", contacts: "live", layout: "home-layout" },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "consuela-settings.json";
      link.click();
      URL.revokeObjectURL(url);
      showFeedback("Exported family settings.", "success");
    } catch {
      showFeedback("Couldn't export family settings. Try again.", "error");
    } finally {
      exportGuardRef.current = false;
      setExporting(false);
    }
  };

  const confirmPush = async () => {
    if (pushGuardRef.current) return;
    pushGuardRef.current = true;
    setPushing(true);
    try {
      const { pushLocalToPB } = await import("@/lib/push-local-to-pb");
      const results = await pushLocalToPB();
      if (!Array.isArray(results) || results.length === 0 || !results.every(isPushResult)) {
        throw new Error("invalid push result");
      }
      const typedResults = results;
      const total = typedResults.reduce((sum, result) => sum + result.pushed, 0);
      const errors = typedResults.reduce((sum, result) => sum + result.errors, 0);
      setPushOpen(false);
      if (errors > 0) {
        showFeedback(
           `Pushed ${total} household ${total === 1 ? "item" : "items"} to the family server · ${errors} ${errors === 1 ? "item needs" : "items need"} attention.`,
          "error",
        );
      } else {
         showFeedback(`Pushed ${total} household ${total === 1 ? "item" : "items"} to the family server.`, "success");
      }
    } catch {
      setPushOpen(false);
      showFeedback("Couldn't push this device's data to the family server. Try again.", "error");
    } finally {
      pushGuardRef.current = false;
      setPushing(false);
    }
  };

  return (
    <section
      aria-label="Connections and System settings"
      data-settings-system="true"
      className="space-y-6"
    >
      <Toast open={feedback !== null} tone={feedback?.tone}>{feedback?.message}</Toast>

      <div className="space-y-4">
        <div>
          <h2 id="settings-system-connections-heading" className="text-lg font-bold text-text-primary">
            Integrations
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Services and accounts that help Consuela work for the family.
          </p>
        </div>
        <div data-settings-integrations="true" role="group" aria-labelledby="settings-system-connections-heading" className="space-y-5">
          <AiModelsCard />
          <ServicesKeysCard />
          <MuseApiCard />
          <GoogleConnectCard />
          <HaNotificationsCard />
        </div>
      </div>

      <SectionCard
        title="Data & sync"
        description="Keep family data available on the family server and across your devices."
        icon="📦"
        headingLevel="h2"
      >
        <div className="space-y-3">
          <div
            data-settings-data-row="true"
            className="flex min-h-20 items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 px-4 py-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">Export family settings</p>
              <p className="mt-1 text-xs leading-5 text-text-secondary">
                Download members, emergency contacts, and the home layout as one JSON file.
              </p>
            </div>
            <SoftButton
              variant="secondary"
              onClick={() => {
                void exportData();
              }}
              disabled={exporting}
              className="shrink-0"
            >
              {exporting ? "Exporting…" : "Export JSON"}
            </SoftButton>
          </div>

          <div
            data-settings-data-row="true"
            className="flex min-h-20 items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/30 px-4 py-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">Push this device&apos;s data</p>
              <p className="mt-1 text-xs leading-5 text-text-secondary">
                 Push household lists saved on this device: grocery, pantry, meals, recipes, events, and routines. Tasks, points, and family goals stay on the family server.
              </p>
            </div>
            <SoftButton
              variant="secondary"
              onClick={() => setPushOpen(true)}
              disabled={pushing}
              className="shrink-0"
            >
              Push local data to family server
            </SoftButton>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Updates"
        description="Check the dashboard version and install an update when it is ready."
        icon="🔄"
        headingLevel="h2"
      >
        <VersionCard />
      </SectionCard>

      <SettingsConfirmDialog
        open={pushOpen}
        title="Push this device's data?"
         description="This pushes grocery, pantry, meals, recipes, events, and routines. Tasks, points, and family goals are not included and stay server-managed."
        confirmLabel="Push data"
        busy={pushing}
        onConfirm={() => {
          void confirmPush();
        }}
        onClose={() => {
          if (!pushing) setPushOpen(false);
        }}
      >
        <p className="text-sm leading-6 text-text-secondary">
          Check the family server connection before continuing. The push can take a moment when there is a lot of local data.
        </p>
      </SettingsConfirmDialog>
    </section>
  );
}
