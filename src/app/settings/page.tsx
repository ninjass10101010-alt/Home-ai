/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useAuth } from "@/hooks/useAuth";
import { type WidgetId, type LayoutMode, ALL_WIDGETS } from "@/lib/layout-config";
import { db } from "@/db";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Toggle from "@/components/ui/Toggle";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import Avatar from "@/components/ui/Avatar";
import TextField from "@/components/ui/TextField";
import FormField from "@/components/patterns/FormField";
import MoreMenuItem from "@/components/patterns/MoreMenuItem";
import SectionCard from "@/components/patterns/SectionCard";
import SettingsErrorBoundary from "@/components/ui/SettingsErrorBoundary";
import GoogleConnectCard from "@/components/settings/GoogleConnectCard";
import HaNotificationsCard from "@/components/settings/HaNotificationsCard";
import ServicesKeysCard from "@/components/settings/ServicesKeysCard";
import AvatarPicker from "@/components/profile/AvatarPicker";
import { warmGlassAccentOptions } from "@/lib/design-tokens";
import { defaultAccentHex, type AccentTarget } from "@/lib/theme-config";
import { useFogConfig } from "@/hooks/useFogConfig";

function normalizeHex(hex: string) {
  const clean = hex.trim().replace("#", "");
  if (clean.length === 3) return `#${clean.split("").map((char) => char + char).join("").toLowerCase()}`;
  return `#${clean.slice(0, 6).toLowerCase()}`;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHex(hex);
  const m = normalized.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return "59,130,246";
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

function rgbaToHex(rgb: string) {
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  const part = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${part(+m[1])}${part(+m[2])}${part(+m[3])}`;
}

function VersionCard() {
  const [data, setData] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<any[]>([]);
  const [updateDone, setUpdateDone] = useState(false);

  useEffect(() => {
    fetch("/api/admin/version")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData({ ok: false }));
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/admin/version", { cache: "no-store" });
      setData(await r.json());
    } catch {
      setData({ ok: false });
    }
    setChecking(false);
  };

  const updateNow = async () => {
    setUpdating(true);
    setUpdateLogs([]);
    setUpdateDone(false);
    try {
      const r = await fetch("/api/admin/update", { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "unauthorized" }));
        setUpdateLogs([{ step: "auth", status: "error", detail: err.error === "adult_only" ? "Adults only — sign in as a parent." : "Sign in required.", timestamp: new Date().toISOString() }]);
        setUpdating(false);
        return;
      }
      const result = await r.json();
      setUpdateLogs(result.logs || []);
      if (result.ok) {
        setUpdateDone(true);
        setTimeout(() => {
          window.location.reload();
        }, 8000);
      }
    } catch (e: any) {
      setUpdateLogs([{ step: "error", status: "error", detail: e.message, timestamp: new Date().toISOString() }]);
    }
    setUpdating(false);
  };

  if (!data) {
    return (
      <div className="flex items-center gap-3">
        <div className="h-4 w-32 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="h-3 w-20 animate-pulse rounded bg-[var(--color-surface-2)]" />
      </div>
    );
  }

  if (data.ok === false) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          {data.error === "adult_only"
            ? "Adults only — sign in as a parent to check dashboard updates."
            : "Couldn't reach the update service — check your connection and try again."}
        </p>
        <SoftButton onClick={checkNow} loading={checking} size="sm">Try again</SoftButton>
      </div>
    );
  }

  const built = data.built_at || {};
  const remote = data.latest_remote;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {built.short && built.short !== "unknown"
              ? `Consuela Dashboard ${built.short}`
              : "Development build"}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {built.message || "—"}
          </p>
          {built.date && (
            <p className="text-[10px] text-text-muted">
              Built {new Date(built.date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        {data.update_available && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-400">
            {data.commits_behind} behind
          </span>
        )}
        {!data.update_available && data.ok && (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
            Up to date
          </span>
        )}
      </div>

      {remote && data.update_available && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-300">
            Latest: {remote.short} — {remote.message || "—"}
          </p>
          <p className="mt-1 text-[10px] text-text-muted">
            Run <span className="font-mono text-text-secondary">bash deploy.sh</span> on the QNAP or rebuild the Docker container to update.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <SoftButton onClick={checkNow} loading={checking} size="sm" className="flex-1">
          Check for updates
        </SoftButton>
        {data.update_available && (
          <SoftButton
            variant="secondary"
            size="sm"
            onClick={() => {
              localStorage.setItem("consuela-last-version-hash", remote.hash || "");
              window.open(
                `https://github.com/ninjass10101010-alt/Home-ai/compare/${built.hash}...${remote.hash}`,
                "_blank",
                "noopener,noreferrer",
              );
            }}
            className="flex-1"
          >
            View changes
          </SoftButton>
        )}
      </div>

      {data.update_available && (
        <SoftButton
          onClick={updateNow}
          loading={updating}
          variant="success"
          className="w-full"
        >
          {updateDone ? "Done — reloading..." : "Update now (self-update)"}
        </SoftButton>
      )}

      {updateLogs.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[var(--color-surface-2)]/60 p-3">
          <p className="mb-2 text-[11px] font-semibold text-text-muted">Update progress:</p>
          <div className="space-y-1">
            {updateLogs.map((log: any, i: number) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-[11px] ${
                  log.status === "error" ? "text-rose-300" : log.status === "ok" ? "text-emerald-300" : "text-text-muted"
                }`}
              >
                <span className="shrink-0">
                  {log.status === "ok" ? "✓" : log.status === "error" ? "✗" : "○"}
                </span>
                <span>{log.detail}</span>
              </div>
            ))}
          </div>
          {updateDone && (
            <p className="mt-2 text-[11px] font-semibold text-emerald-300">
              ✅ Update complete — page will reload in a few seconds...
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setMode, setAccentColor, setContrastBoost, setAccentHex } = useTheme();
  const { config, orientation, visibleWidgetsFor, orderedWidgetsFor, moveUpFor, moveDownFor, reorderFor, toggleFor, resetLayout, setSuppressRehydrate } = useHomeLayout();
  const fog = useFogConfig();
  const { currentUser, isLoggedIn, logout } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [accentTarget, setAccentTarget] = useState<AccentTarget>("selected");
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [editingContact, setEditingContact] = useState<any | null>(null);
  const [memberForm, setMemberForm] = useState<any>({ name: "", emoji: "😊", role: "child", pin: "", avatarSize: "md", glow: false, imageUrl: "" });
  const [contactForm, setContactForm] = useState<any>({ name: "", phone: "", email: "", relationship: "parent", isPrimary: false, emoji: "👤" });
  const [mounted, setMounted] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [draggingId, setDraggingId] = useState<WidgetId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<WidgetId | null>(null);
  const [editingOrientation, setEditingOrientation] = useState<LayoutMode>(orientation);
  const [savingMember, setSavingMember] = useState(false);
  const [memberErrors, setMemberErrors] = useState<{ name?: string; pin?: string }>({});
  const [contactErrors, setContactErrors] = useState<{ name?: string; phone?: string; email?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "member" | "contact"; item: any } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testingAlert, setTestingAlert] = useState(false);
  const [pushingCloud, setPushingCloud] = useState(false);

  const rowRefs = useRef(new Map<WidgetId, HTMLDivElement | null>());
  const prevPositions = useRef<Map<WidgetId, number> | null>(null);
  const reorderPending = useRef(false);

  useEffect(() => {
    setMounted(true);
    setMembers(db.selectMembersDetailed());
    setContacts(db.selectEmergencyContacts());
    setSuppressRehydrate(true);
    return () => setSuppressRehydrate(false);
  }, [setSuppressRehydrate]);

  const profileMember = mounted && currentUser
    ? members.find((m: any) => m.name === currentUser.name || m.fullName === currentUser.name) || members[0]
    : members[0];

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const widgetLabel = (id: WidgetId) => ALL_WIDGETS.find((w) => w.id === id)?.label ?? id;

  const editingOrdered = orderedWidgetsFor(editingOrientation);
  const editingVisible = visibleWidgetsFor(editingOrientation);
  const hiddenIds = new Set(config[editingOrientation].hidden);
  const visibleCount = editingVisible.length;

  const recordPositions = () => {
    const map = new Map<WidgetId, number>();
    for (const [id, el] of rowRefs.current) {
      if (el) map.set(id, el.getBoundingClientRect().top);
    }
    prevPositions.current = map;
    reorderPending.current = true;
  };

  const handleMoveUp = (id: WidgetId) => {
    recordPositions();
    moveUpFor(editingOrientation, id);
    showToast(`↕️ Moved ${widgetLabel(id)} up (${editingOrientation})`);
  };

  const handleMoveDown = (id: WidgetId) => {
    recordPositions();
    moveDownFor(editingOrientation, id);
    showToast(`↕️ Moved ${widgetLabel(id)} down (${editingOrientation})`);
  };

  const handleReorder = (id: WidgetId, targetIndex: number) => {
    recordPositions();
    reorderFor(editingOrientation, id, targetIndex);
    showToast(`↕️ Reordered ${widgetLabel(id)} (${editingOrientation})`);
  };

  const handleToggle = (id: WidgetId, nextVisible: boolean) => {
    toggleFor(editingOrientation, id);
    showToast(nextVisible ? `✅ Showing ${widgetLabel(id)} (${editingOrientation})` : `🚫 Hiding ${widgetLabel(id)} (${editingOrientation})`);
  };

  const handleDragStart = (id: WidgetId) => (event: React.DragEvent) => {
    setDraggingId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (id: WidgetId) => (event: React.DragEvent) => {
    if (!draggingId || draggingId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(id);
  };

  const handleDragLeave = (id: WidgetId) => () => {
    if (dropTargetId === id) setDropTargetId(null);
  };

  const handleDrop = (targetId: WidgetId) => (event: React.DragEvent) => {
    event.preventDefault();
    const sourceId = (event.dataTransfer.getData("text/plain") || draggingId) as WidgetId | null;
    setDraggingId(null);
    setDropTargetId(null);
    if (!sourceId || sourceId === targetId) return;
    const targetIndex = editingOrdered.findIndex((w) => w.id === targetId);
    if (targetIndex === -1) return;
    handleReorder(sourceId, targetIndex);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  useEffect(() => {
    if (!reorderPending.current || !prevPositions.current) return;
    reorderPending.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const prev = prevPositions.current;
    prevPositions.current = null;
    for (const [id, el] of rowRefs.current) {
      if (!el) continue;
      const oldTop = prev.get(id);
      if (oldTop === undefined) continue;
      const newTop = el.getBoundingClientRect().top;
      const delta = oldTop - newTop;
      if (Math.abs(delta) < 1) continue;
      el.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
        { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
  }, [editingOrdered]);

  const accentTargetHex = (target: AccentTarget) => {
    const value = theme.accentHex[target];
    return normalizeHex(value.startsWith("#") ? value : rgbaToHex(value) ?? defaultAccentHex.selected);
  };

  const setTargetColor = (target: AccentTarget, value: string) => {
    const hex = normalizeHex(value);
    if (target === "glow") setAccentHex("glow", `rgba(${hexToRgb(hex)},0.28)`);
    else if (target === "border") setAccentHex("border", `rgba(${hexToRgb(hex)},0.35)`);
    else setAccentHex(target, hex);
  };

  const openMemberModal = (member?: any) => {
    setEditingMember(member || null);
    const currentEmoji = member?.emoji || "😊";
    const hasCustomImage = currentEmoji.startsWith("data:") || currentEmoji.startsWith("http");
    setMemberForm(member ? {
      name: member.name || "",
      emoji: hasCustomImage ? "😊" : currentEmoji,
      role: member.role || "child",
      pin: member.pin || "",
      avatarSize: member.avatarSize || "md",
      glow: member.glow || false,
      imageUrl: hasCustomImage ? currentEmoji : "",
    } : { name: "", emoji: "😊", role: "child", pin: "", avatarSize: "md", glow: false, imageUrl: "" });
    setMemberErrors({});
    setMemberModalOpen(true);
  };

  const validateMember = () => {
    const errors: { name?: string; pin?: string } = {};
    if (!memberForm.name.trim()) errors.name = "Enter a name so tasks and avatars know who this is.";
    if (memberForm.pin && !/^\d{4}$/.test(memberForm.pin))
      errors.pin = editingMember
        ? "PIN must be exactly 4 digits — or leave it blank to keep the current PIN."
        : "PIN must be exactly 4 digits.";
    setMemberErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveMember = async () => {
    if (!validateMember()) return;
    setSavingMember(true);
    try {
      const base = {
        ...memberForm,
        name: memberForm.name.trim(),
        emoji: memberForm.imageUrl?.trim() || memberForm.emoji,
      };
      // A blank PIN field means "leave the stored PIN unchanged" — never wipe
      // an existing PocketBase pin just because the form prefilled empty.
      const payload = editingMember && !base.pin
        ? Object.fromEntries(Object.entries(base).filter(([k]) => k !== "pin"))
        : base;
      if (editingMember) {
        // Edits go through the adults-only server route — the browser can no
        // longer write members straight to PocketBase.
        try {
          const res = await fetch("/api/members/admin", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: editingMember.name, patch: payload }),
          });
          if (!res.ok) {
            showToast(res.status === 403 ? "🔒 Adults only — sign in as a parent to edit members." : "❌ Couldn't update member");
            return;
          }
        } catch {
          showToast("❌ Couldn't update member");
          return;
        }
        showToast(`✅ Updated ${memberForm.name.trim()}`);
      } else {
        // Adds go through the adults-only server route too — the browser can no
        // longer create members straight in PocketBase (locked createRule), and
        // the server resolves the new member's PIN itself.
        try {
          const res = await fetch("/api/members/admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, joined: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }) }),
          });
          if (!res.ok) {
            showToast(
              res.status === 403
                ? "🔒 Adults only — sign in as a parent to add members."
                : res.status === 409
                  ? `⚠️ ${memberForm.name.trim()} is already on the family list.`
                  : "❌ Couldn't add member"
            );
            return;
          }
        } catch {
          showToast("❌ Couldn't add member");
          return;
        }
        showToast(`✅ Added ${memberForm.name.trim()}`);
      }
      setMembers(db.selectMembersDetailed());
      setMemberModalOpen(false);
    } finally {
      setSavingMember(false);
    }
  };

  const deleteMember = async (member: any) => {
    setDeleting(true);
    try {
      try {
        const res = await fetch("/api/members/admin", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: member.name }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}) as any);
          showToast(err.error === "last_parent" ? "⚠️ At least one parent must remain." : "❌ Couldn't remove member");
          return;
        }
      } catch {
        showToast("❌ Couldn't remove member");
        return;
      }
      showToast(`🗑️ Removed ${member.name}`);
      setMembers(db.selectMembersDetailed());
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const openContactModal = (contact?: any) => {
    setEditingContact(contact || null);
    setContactForm(contact || { name: "", phone: "", email: "", relationship: "parent", isPrimary: false, emoji: "👤" });
    setContactErrors({});
    setContactModalOpen(true);
  };

  const validateContact = () => {
    const errors: { name?: string; phone?: string; email?: string } = {};
    if (!contactForm.name.trim()) errors.name = "Enter a name for this contact.";
    if (!contactForm.phone.trim()) errors.phone = "Enter a phone number so alerts can reach them.";
    else if (contactForm.phone.replace(/\D/g, "").length < 7)
      errors.phone = "That number looks too short — include the country code, e.g. +15551234567.";
    if (!contactForm.email.trim()) errors.email = "Enter an email as a backup alert channel.";
    else if (!/^\S+@\S+\.\S+$/.test(contactForm.email.trim()))
      errors.email = "That email looks incomplete — try something like name@example.com.";
    setContactErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveContact = () => {
    if (!validateContact()) return;
    if (editingContact) {
      db.updateEmergencyContact(editingContact.id, { ...contactForm, name: contactForm.name.trim(), phone: contactForm.phone.trim(), email: contactForm.email.trim() });
      showToast(`✅ Updated ${contactForm.name.trim()}`);
    } else {
      db.insertEmergencyContact({ ...contactForm, name: contactForm.name.trim(), phone: contactForm.phone.trim(), email: contactForm.email.trim() });
      showToast(`✅ Added ${contactForm.name.trim()}`);
    }
    setContacts(db.selectEmergencyContacts());
    setContactModalOpen(false);
  };

  const deleteContact = (contact: any) => {
    db.deleteEmergencyContact(contact.id);
    showToast(`🗑️ Removed ${contact.name}`);
    setContacts(db.selectEmergencyContacts());
    setConfirmDelete(null);
  };

  const handleResetLayout = () => {
    resetLayout();
    showToast("🔄 Layout reset for phone, tablet, and desktop");
  };

  const inviteMember = async () => {
    const shareData = { title: "Consuela — AI Family Organizer", text: "Join our family on Consuela! Manage calendars, meals, chores, and more.", url: window.location.origin };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(shareData.url);
        showToast("📋 Link copied to clipboard");
      } catch {
        showToast("📋 Share link: " + shareData.url);
      }
    }
  };

  const testEmergencyAlert = async () => {
    // NOTE: the session pin is never held in the client bundle (security
    // model — see AGENTS.md). `currentUser?.pin` is therefore undefined; the
    // test button is disabled unless a pin is available. Kept read-only here
    // for wire-compatibility with /api/emergency, which expects a pin.
    const sessionPin = (currentUser as { pin?: string } | null)?.pin;
    setTestingAlert(true);
    try {
      const res = await fetch("/api/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "General", timestamp: new Date().toISOString(), pin: sessionPin }),
      });
      const data = await res.json();
      showToast(data.success ? "✅ Test alert sent" : "❌ Alert failed — check emergency contacts");
    } catch {
      showToast("❌ Could not send test alert");
    } finally {
      setTestingAlert(false);
    }
  };

  const [helpModalOpen, setHelpModalOpen] = useState(false);

  const exportData = () => {
    const data = {
      members,
      contacts,
      layout: {
        phone: config.phone,
        tablet: config.tablet,
        desktop: config.desktop,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "consuela-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("✅ Exported settings");
  };

  const pushToCloud = async () => {
    setPushingCloud(true);
    showToast("⏳ Pushing local data to cloud...");
    try {
      const { pushLocalToPB } = await import("@/lib/push-local-to-pb");
      const results = await pushLocalToPB();
      const total = results.reduce((s, r) => s + r.pushed, 0);
      const errors = results.reduce((s, r) => s + r.errors, 0);
      const detail = results.filter(r => r.pushed > 0).map(r => `${r.collection}: ${r.pushed}`).join(", ");
      showToast(`☁️ Pushed ${total} items to PB${errors ? ` (${errors} errors)` : ""} — ${detail}`);
    } catch {
      showToast("❌ Push failed — check console for details");
    } finally {
      setPushingCloud(false);
    }
  };

  return (
    <PageShell>
      <SettingsErrorBoundary>
        <Toast open={Boolean(toast)} tone={toast?.includes("🗑️") || toast?.includes("Removed") ? "error" : "success"}>{toast}</Toast>

        <PageHeader
          title="Settings"
          subtitle="Customize your Consuela experience"
          action={
            <IconButton aria-label="Sign out" onClick={logout} disabled={!isLoggedIn}>
              <span>🚪</span>
            </IconButton>
          }
          icon="⚙️"
        />

        <div className="px-4 space-y-6 pb-8">
          <SectionCard title="Profile" description="Who is using Consuela right now?" icon="👤">
            <div className="flex items-center gap-4">
              <Avatar name={profileMember?.name || "Family"} color="green" emoji={profileMember?.emoji || "😊"} size="lg" variant="emoji" glow />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-text-primary">{profileMember?.name || "Family"}</h3>
                <p className="mt-0.5 text-sm text-text-secondary">{profileMember?.role || "Family"}</p>
              </div>
              <SoftButton variant="secondary" onClick={() => openMemberModal(profileMember)} className="shrink-0">Edit</SoftButton>
            </div>
          </SectionCard>

          <SectionCard title="Appearance" description="Theme, accent, and contrast controls" icon="🎨">
            <div className="space-y-5">
              <SegmentedControl
                aria-label="Display mode"
                value={theme.mode}
                onChange={(value) => setMode(value as "light" | "dark" | "system")}
                options={[
                  { id: "system", label: "Auto" },
                  { id: "light", label: "Day" },
                  { id: "dark", label: "Night" },
                ]}
              />

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {warmGlassAccentOptions.map((accent) => (
                  <button
                    key={accent.id}
                    type="button"
                    aria-pressed={theme.accentColor === accent.id}
                    title={accent.description}
                    onClick={() => {
                      setAccentColor(accent.id);
                      setAccentHex("selected", accent.hex);
                      setAccentHex("glow", accent.glow);
                      setAccentHex("button", accent.hex);
                      setAccentHex("border", accent.glow);
                    }}
                    className={`tap-sm rounded-2xl border p-3 text-left ${
                      theme.accentColor === accent.id ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10" : "border-white/10 bg-[var(--color-surface-0)]/30"
                    }`}
                  >
                    <div className="h-10 rounded-xl" style={{ background: accent.hex }} />
                    <div className="mt-2 text-xs font-semibold text-text-primary">{accent.label}</div>
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Surface variant="glass-subtle" radius="xl" padding="sm">
                  <h4 className="mb-3 text-sm font-bold text-text-primary">Accent target</h4>
                  <SegmentedControl
                    aria-label="Accent target"
                    value={accentTarget}
                    onChange={(value) => setAccentTarget(value as AccentTarget)}
                    options={[
                      { id: "selected", label: "Selected" },
                      { id: "glow", label: "Glow" },
                      { id: "button", label: "Button" },
                      { id: "border", label: "Border" },
                    ]}
                  />
                  <div className="mt-4 flex items-center gap-3">
                    <input
                      type="color"
                      value={accentTargetHex(accentTarget)}
                      onChange={(event) => setTargetColor(accentTarget, event.target.value)}
                      aria-label={`Custom ${accentTarget} accent color`}
                      className="h-12 w-12 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] p-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text-primary">Custom accent</div>
                      <div className="text-xs text-text-muted">Live updates the selected target.</div>
                    </div>
                  </div>
                </Surface>
                <Surface variant="glass-subtle" radius="xl" padding="sm">
                  <Toggle checked={theme.contrastBoost} onCheckedChange={setContrastBoost} label="High contrast" description="Boosts text and border contrast for easier reading." />
                </Surface>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Cloud Background" description="Fog and particle effects behind the Home dashboard" icon="☁️">
            <div className="space-y-4">
              <Toggle
                checked={fog.config.enabled}
                onCheckedChange={fog.setEnabled}
                label="Enable animated fog"
                description="Fullscreen 3D fog + drifting particles on the Home screen."
              />
              {fog.config.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="fog-highlight-color" className="mb-1 block text-xs font-semibold text-text-secondary">Highlight color</label>
                      <div className="flex items-center gap-2">
                        <input
                          id="fog-highlight-color"
                          type="color"
                          value={fog.config.highlightColor}
                          onChange={(e) => fog.setHighlightColor(e.target.value)}
                          className="h-11 w-11 shrink-0 rounded-xl border border-white/10 bg-[var(--color-surface-2)] p-1"
                        />
                        <span className="truncate text-[11px] text-text-muted">{fog.config.highlightColor}</span>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="fog-lowlight-color" className="mb-1 block text-xs font-semibold text-text-secondary">Lowlight color</label>
                      <div className="flex items-center gap-2">
                        <input
                          id="fog-lowlight-color"
                          type="color"
                          value={fog.config.lowlightColor}
                          onChange={(e) => fog.setLowlightColor(e.target.value)}
                          className="h-11 w-11 shrink-0 rounded-xl border border-white/10 bg-[var(--color-surface-2)] p-1"
                        />
                        <span className="truncate text-[11px] text-text-muted">{fog.config.lowlightColor}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="fog-speed" className="mb-1 block text-xs font-semibold text-text-secondary">
                      Speed — {fog.config.speed.toFixed(1)}
                    </label>
                    <input
                      id="fog-speed"
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={fog.config.speed}
                      onChange={(e) => fog.setSpeed(parseFloat(e.target.value))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-surface-3)] accent-[var(--color-accent-selected)]"
                    />
                    <div className="mt-0.5 flex justify-between text-[10px] text-text-muted">
                      <span>Still</span>
                      <span>Fast</span>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="fog-blur" className="mb-1 block text-xs font-semibold text-text-secondary">
                      Blur — {fog.config.blurFactor.toFixed(2)}
                    </label>
                    <input
                      id="fog-blur"
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={fog.config.blurFactor}
                      onChange={(e) => fog.setBlurFactor(parseFloat(e.target.value))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-surface-3)] accent-[var(--color-accent-selected)]"
                    />
                    <div className="mt-0.5 flex justify-between text-[10px] text-text-muted">
                      <span>Sharp</span>
                      <span>Soft</span>
                    </div>
                  </div>
                  <SoftButton variant="secondary" onClick={fog.resetConfig} className="w-full">
                    Reset to defaults
                  </SoftButton>
                </>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Family members" description="People, pets, and roles" icon="👨‍👩‍👧‍👦">
            <div className="space-y-3">
              {members.map((member: any) => (
                <ListRow
                  key={member.name}
                  title={member.name}
                  subtitle={`${member.role} · ${member.joined}`}
                  leftRailColor="var(--color-accent-apricot)"
                  leading={<Avatar name={member.name} color="green" emoji={member.emoji} size="sm" variant="emoji" />}
                  trailing={
                    <div className="flex items-center gap-1">
                      <IconButton size="sm" variant="ghost" aria-label="Edit member" onClick={() => openMemberModal(member)}>✎</IconButton>
                      <IconButton size="sm" variant="danger" aria-label={`Remove ${member.name}`} onClick={() => setConfirmDelete({ kind: "member", item: member })}>×</IconButton>
                    </div>
                  }
                />
              ))}
              {members.length === 0 && <EmptyState title="No members yet" description="Add the first family member to start organizing." actionLabel="Add member" onAction={() => openMemberModal()} />}
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton onClick={() => openMemberModal()} className="flex-1">Add member</SoftButton>
              <SoftButton variant="secondary" onClick={inviteMember} className="flex-1">Invite</SoftButton>
            </div>
          </SectionCard>

          <SectionCard title="Emergency contacts" description="Who gets serious alerts from the home FAB." icon="🛡️">
            <div className="space-y-3">
              {contacts.map((contact: any) => (
                <ListRow
                  key={contact.id}
                  title={contact.name}
                  subtitle={`${contact.phone} · ${contact.email}`}
                  leftRailColor={contact.isPrimary ? "var(--color-accent-rose)" : "var(--color-accent-sage)"}
                  leading={<span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--color-surface-2)] text-xl">{contact.emoji || "👤"}</span>}
                  trailing={
                    <div className="flex items-center gap-1">
                      <IconButton size="sm" variant="ghost" aria-label="Edit contact" onClick={() => openContactModal(contact)}>✎</IconButton>
                      <IconButton size="sm" variant="danger" aria-label={`Remove ${contact.name}`} onClick={() => setConfirmDelete({ kind: "contact", item: contact })}>×</IconButton>
                    </div>
                  }
                />
              ))}
              {contacts.length === 0 && <EmptyState title="No emergency contacts" description="Add a primary contact for serious alerts." actionLabel="Add contact" onAction={() => openContactModal()} />}
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton onClick={() => openContactModal()} className="flex-1">Add contact</SoftButton>
              <SoftButton variant="secondary" onClick={testEmergencyAlert} loading={testingAlert} disabled={!(currentUser as { pin?: string } | null)?.pin} className="flex-1">
                {(currentUser as { pin?: string } | null)?.pin ? "Test" : "Sign in to test"}
              </SoftButton>
            </div>
          </SectionCard>

          <SectionCard title="Emergency" description="Call cards, common situations, and 911 reference." icon="🛡️" tone="#f43f5e">
            <MoreMenuItem icon="🛡️" title="Open emergency reference" description="Contacts, common situations, and 911" href="/emergency" />
          </SectionCard>

          <SectionCard
            title="Integrations"
            description="Connect external accounts to sync calendar events, tasks, and reminders."
            icon="🔗"
          >
            <ServicesKeysCard />
            <GoogleConnectCard />
            <HaNotificationsCard />
          </SectionCard>

          <SectionCard title="Layout & display" description="Show, hide, and reorder Home widgets." icon="🧩">
            <div className="space-y-3">
              <SegmentedControl
                options={[
                  { id: "phone", label: "📱 Phone" },
                  { id: "tablet", label: "📱 Tablet" },
                  { id: "desktop", label: "🖥️ Desktop" },
                ]}
                value={editingOrientation}
                onChange={(value) => setEditingOrientation(value as LayoutMode)}
                aria-label="Layout mode"
              />
              <p className="text-[11px] text-text-muted">
                Each orientation keeps its own order. {editingOrientation === orientation
                  ? "You're editing the layout your device is using right now."
                  : `Your device is in ${orientation} — the ${orientation} layout applies automatically.`}
              </p>
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                <span>All widgets</span>
                <span>{visibleCount} on Home</span>
              </div>
              <div className="space-y-3">
                {editingOrdered.map((widget, index) => {
                  const isDropTarget = dropTargetId === widget.id && draggingId !== widget.id;
                  const isHidden = hiddenIds.has(widget.id);
                  return (
                    <div
                      key={widget.id}
                      ref={(el) => { rowRefs.current.set(widget.id, el); }}
                      data-widget-id={widget.id}
                      onDragOver={handleDragOver(widget.id)}
                      onDragLeave={handleDragLeave(widget.id)}
                      onDrop={handleDrop(widget.id)}
                      onDragEnd={handleDragEnd}
                      className={`rounded-2xl transition ${isDropTarget ? "ring-2 ring-[var(--color-accent-selected)] ring-offset-2 ring-offset-[var(--color-canvas)]" : ""} ${draggingId === widget.id ? "opacity-50" : ""}`}
                    >
                      <ListRow
                        title={widget.label}
                        subtitle={widget.description}
                        leftRailColor="var(--color-accent-sage)"
                        className={isHidden ? "opacity-55 transition-opacity duration-300" : "transition-opacity duration-300"}
                        leading={
                          <span
                            draggable
                            onDragStart={handleDragStart(widget.id)}
                            className="grid h-9 w-6 cursor-grab place-items-center text-text-muted active:cursor-grabbing"
                            aria-hidden="true"
                            title="Drag to reorder"
                          >
                            ⋮⋮
                          </span>
                        }
                        trailing={
                          <div className="flex items-center gap-1">
                            <Toggle
                              checked={!isHidden}
                              onCheckedChange={(checked) => handleToggle(widget.id, checked)}
                              aria-label={`${isHidden ? "Show" : "Hide"} ${widget.label}`}
                            />
                            <IconButton size="sm" variant="ghost" aria-label={`Move ${widget.label} up`} disabled={index === 0} onClick={() => handleMoveUp(widget.id)}>↑</IconButton>
                            <IconButton size="sm" variant="ghost" aria-label={`Move ${widget.label} down`} disabled={index === editingOrdered.length - 1} onClick={() => handleMoveDown(widget.id)}>↓</IconButton>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
              {visibleCount === 0 && (
                <p className="text-xs text-text-muted">All widgets are hidden — turn one on to fill the Home dashboard.</p>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton variant="secondary" onClick={handleResetLayout} className="flex-1">Reset layout</SoftButton>
              <SoftButton variant="ghost" onClick={() => setHelpModalOpen(true)} className="flex-1">Help</SoftButton>
            </div>
          </SectionCard>

          <SectionCard title="Data & sync" description="Export settings or push local data to cloud." icon="📦">
            <div className="grid gap-3 sm:grid-cols-1">
              <Surface variant="glass-subtle" radius="xl" padding="sm">
                <div className="text-sm font-bold text-text-primary">Local settings</div>
                <p className="mt-1 text-xs text-text-secondary">Export your family members, emergency contacts, and home layout as a single JSON file. Reset is in the Layout section above.</p>
              </Surface>
              <Surface variant="glass-subtle" radius="xl" padding="sm">
                <div className="text-sm font-bold text-text-primary">Cloud sync</div>
                <p className="mt-1 text-xs text-text-secondary">Push your existing local data (grocery, pantry, meals, recipes, events, schedules) to PocketBase so it syncs across devices.</p>
              </Surface>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <SoftButton onClick={exportData} className="w-full">Export JSON</SoftButton>
              <SoftButton
                onClick={pushToCloud}
                loading={pushingCloud}
                variant="secondary"
                className="w-full"
              >
                ☁️ Push local data to cloud
              </SoftButton>
            </div>
          </SectionCard>

          <SectionCard title="Updates" description="Dashboard version and one-click deploy" icon="🔄">
            <VersionCard />
          </SectionCard>
        </div>

        <Modal
          open={memberModalOpen}
          onClose={() => setMemberModalOpen(false)}
          title={editingMember ? "Edit member" : "Add member"}
          description="Family members appear in avatars, tasks, and the Home row."
          footer={
            <>
              <SoftButton onClick={saveMember} loading={savingMember} className="flex-1">Save</SoftButton>
              <SoftButton variant="secondary" onClick={() => setMemberModalOpen(false)} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Name" errorText={memberErrors.name}>
              <input value={memberForm.name} onChange={(e) => { setMemberForm((prev: any) => ({ ...prev, name: e.target.value })); setMemberErrors((prev) => ({ ...prev, name: undefined })); }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary" placeholder="Member name" />
            </FormField>
            <FormField label="Avatar">
              <AvatarPicker
                value={memberForm.imageUrl?.startsWith("data:") || memberForm.imageUrl?.startsWith("http") ? memberForm.imageUrl : memberForm.emoji || "😊"}
                fallbackEmoji={memberForm.emoji || "😊"}
                onChange={(next) =>
                  setMemberForm((prev: any) => {
                    const isImage = next.startsWith("data:") || next.startsWith("http");
                    return { ...prev, imageUrl: isImage ? next : "", emoji: isImage ? prev.emoji || "😊" : next };
                  })
                }
              />
            </FormField>
            <FormField label="Role">
              <select value={memberForm.role} onChange={(e) => setMemberForm((prev: any) => ({ ...prev, role: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                <option value="parent">Parent</option>
                <option value="child">Child</option>
                <option value="pet">Pet</option>
              </select>
            </FormField>
            <FormField label="PIN" helperText={editingMember ? "Leave blank to keep the current PIN." : "4 digits — used to sign in and approve things."} errorText={memberErrors.pin}>
              <input type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={memberForm.pin} onChange={(e) => { setMemberForm((prev: any) => ({ ...prev, pin: e.target.value.replace(/[^0-9]/g, "") })); setMemberErrors((prev) => ({ ...prev, pin: undefined })); }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-secondary" placeholder="0000" />
            </FormField>
            <div className="flex items-center justify-between">
              <FormField label="Avatar size">
                <div className="flex gap-1.5">
                  {(["xs", "sm", "md", "lg"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={memberForm.avatarSize === s}
                      onClick={() => setMemberForm((prev: any) => ({ ...prev, avatarSize: s }))}
                      className={`tap-sm rounded-xl px-3 py-1.5 text-xs font-bold ${
                        memberForm.avatarSize === s
                          ? "bg-[var(--color-accent-selected)] text-white"
                          : "glass-subtle text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </FormField>
              <Toggle
                checked={memberForm.glow}
                onCheckedChange={(checked) => setMemberForm((prev: any) => ({ ...prev, glow: checked }))}
                label="Glow"
              />
            </div>
          </div>
        </Modal>

        <Modal
          open={contactModalOpen}
          onClose={() => setContactModalOpen(false)}
          title={editingContact ? "Edit contact" : "Add contact"}
          description="Primary contacts receive serious emergency alerts from the Home FAB."
          footer={
            <>
              <SoftButton onClick={saveContact} className="flex-1">Save</SoftButton>
              <SoftButton variant="secondary" onClick={() => setContactModalOpen(false)} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Name" errorText={contactErrors.name}>
              <input value={contactForm.name} onChange={(e) => { setContactForm((prev: any) => ({ ...prev, name: e.target.value })); setContactErrors((prev) => ({ ...prev, name: undefined })); }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary" placeholder="Contact name" />
            </FormField>
            <FormField label="Phone" helperText="Include the country code so carrier SMS gateways can deliver." errorText={contactErrors.phone}>
              <input type="tel" value={contactForm.phone} onChange={(e) => { setContactForm((prev: any) => ({ ...prev, phone: e.target.value })); setContactErrors((prev) => ({ ...prev, phone: undefined })); }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary" placeholder="+15551234567" />
            </FormField>
            <FormField label="Email" errorText={contactErrors.email}>
              <input type="email" value={contactForm.email} onChange={(e) => { setContactForm((prev: any) => ({ ...prev, email: e.target.value })); setContactErrors((prev) => ({ ...prev, email: undefined })); }} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary" placeholder="name@example.com" />
            </FormField>
            <FormField label="Relationship">
              <select value={contactForm.relationship} onChange={(e) => setContactForm((prev: any) => ({ ...prev, relationship: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                <option value="parent">Parent</option>
                <option value="guardian">Guardian</option>
                <option value="grandparent">Grandparent</option>
                <option value="neighbor">Neighbor</option>
                <option value="other">Other</option>
              </select>
            </FormField>
            <Toggle checked={contactForm.isPrimary} onCheckedChange={(checked) => setContactForm((prev: any) => ({ ...prev, isPrimary: checked }))} label="Primary contact" />
          </div>
        </Modal>

        <Modal
          open={Boolean(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
          title={confirmDelete ? `Remove ${confirmDelete.item.name}?` : "Remove"}
          footer={
            <>
              <SoftButton
                variant="danger"
                loading={deleting}
                onClick={() => {
                  if (!confirmDelete) return;
                  if (confirmDelete.kind === "member") deleteMember(confirmDelete.item);
                  else deleteContact(confirmDelete.item);
                }}
                className="flex-1"
              >
                Remove
              </SoftButton>
              <SoftButton variant="secondary" onClick={() => setConfirmDelete(null)} className="flex-1">Keep</SoftButton>
            </>
          }
        >
          <p className="text-sm text-text-secondary">
            {confirmDelete?.kind === "member"
              ? `${confirmDelete.item.name} will disappear from avatars, tasks, and the family row on every device.`
              : "They will stop receiving emergency alerts. You can add them back anytime."}
          </p>
        </Modal>

        <Modal open={helpModalOpen} onClose={() => setHelpModalOpen(false)} title="Layout & display help" description="Control which widgets appear on your Home dashboard." footer={<SoftButton variant="secondary" onClick={() => setHelpModalOpen(false)} className="flex-1">Got it</SoftButton>}>
          <div className="space-y-4 text-sm text-text-secondary">
            <p>Widgets are listed in the order they appear on Home. Toggle a widget off and its row stays in place, dimmed — hidden widgets don&apos;t appear on the Home dashboard. Use ↑/↓ or drag the ⋮⋮ handle to reorder any row, hidden or visible. Each device type (Phone / Tablet / Desktop) keeps its own order and visibility.</p>
            <p><strong className="text-text-primary">Phone / Tablet / Desktop</strong> — Each layout mode keeps its own widget order and visibility. Switch the tabs at the top of this card to edit a different mode; Consuela applies the right layout automatically when your device rotates or resizes. On tablet and desktop the widgets tile into a bento grid with the weather card as the larger two-by-two hero and every other card a uniform square; on tablet, when there&apos;s an odd number of square cards, the last one stretches across the full row.</p>
            <p><strong className="text-text-primary">Reset layout</strong> — Restores all three layout modes (phone, tablet, desktop) to their default order and visibility.</p>
          </div>
        </Modal>
      </SettingsErrorBoundary>
    </PageShell>
  );
}
