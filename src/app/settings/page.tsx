/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useAuth } from "@/hooks/useAuth";
import { type WidgetId } from "@/lib/layout-config";
import { db } from "@/db";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Chip from "@/components/ui/Chip";
import Toggle from "@/components/ui/Toggle";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Modal from "@/components/ui/Modal";
import Toast from "@/components/ui/Toast";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Avatar from "@/components/ui/Avatar";
import TextField from "@/components/ui/TextField";
import FormField from "@/components/patterns/FormField";
import SectionCard from "@/components/patterns/SectionCard";
import SettingsErrorBoundary from "@/components/ui/SettingsErrorBoundary";
import GoogleConnectCard from "@/components/settings/GoogleConnectCard";
import { warmGlassAccentOptions } from "@/lib/design-tokens";
import { defaultAccentHex, type AccentTarget } from "@/lib/theme-config";
import { useFogConfig } from "@/hooks/useFogConfig";

const emojiOptions = ["👨","👩","👧","🧒","👶","👴","👵","🐶","🐱","🐩","🐕","🐈","🐠","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵"];

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

export default function SettingsPage() {
  const { theme, setMode, setAccentColor, setContrastBoost, setAccentHex } = useTheme();
  const { widgets, visibleWidgets, hiddenWidgets, toggle, moveUp, moveDown, reorder, setSuppressRehydrate } = useHomeLayout();
  const fog = useFogConfig();
  const { currentUser, isLoggedIn, logout } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [accentTarget, setAccentTarget] = useState<AccentTarget>("selected");
  const [customHex, setCustomHex] = useState(defaultAccentHex[accentTarget]);
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

  const widgetLabel = (id: WidgetId) =>
    visibleWidgets.find((w) => w.id === id)?.label ||
    hiddenWidgets.find((w) => w.id === id)?.label ||
    id;

  const handleMoveUp = (id: WidgetId) => {
    moveUp(id);
    showToast(`↕️ Moved ${widgetLabel(id)} up`);
  };

  const handleMoveDown = (id: WidgetId) => {
    moveDown(id);
    showToast(`↕️ Moved ${widgetLabel(id)} down`);
  };

  const handleReorder = (id: WidgetId, targetIndex: number) => {
    reorder(id, targetIndex);
    showToast(`↕️ Reordered ${widgetLabel(id)}`);
  };

  const handleToggle = (id: WidgetId, nextVisible: boolean) => {
    toggle(id);
    showToast(nextVisible ? `✅ Showing ${widgetLabel(id)}` : `🚫 Hiding ${widgetLabel(id)}`);
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
    const targetIndex = visibleWidgets.findIndex((w) => w.id === targetId);
    if (targetIndex === -1) return;
    handleReorder(sourceId, targetIndex);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  const setTargetColor = (target: AccentTarget, value: string) => {
    const hex = normalizeHex(value);
    if (target === "glow") setAccentHex("glow", `rgba(${hexToRgb(hex)},0.28)`);
    else if (target === "border") setAccentHex("border", `rgba(${hexToRgb(hex)},0.35)`);
    else setAccentHex(target, hex);
    setCustomHex(hex);
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
    setMemberModalOpen(true);
  };

  const saveMember = () => {
    if (!memberForm.name.trim()) return;
    const payload = {
      ...memberForm,
      name: memberForm.name.trim(),
      emoji: memberForm.imageUrl?.trim() || memberForm.emoji,
    };
    if (editingMember) {
      db.updateMember(editingMember.name, payload);
      showToast(`✅ Updated ${memberForm.name.trim()}`);
    } else {
      db.insertMember({ ...payload, joined: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }) });
      showToast(`✅ Added ${memberForm.name.trim()}`);
    }
    setMembers(db.selectMembersDetailed());
    setMemberModalOpen(false);
  };

  const deleteMember = (member: any) => {
    db.deleteMember(member.name);
    showToast(`🗑️ Removed ${member.name}`);
    setMembers(db.selectMembersDetailed());
  };

  const openContactModal = (contact?: any) => {
    setEditingContact(contact || null);
    setContactForm(contact || { name: "", phone: "", email: "", relationship: "parent", isPrimary: false, emoji: "👤" });
    setContactModalOpen(true);
  };

  const saveContact = () => {
    if (!contactForm.name.trim() || !contactForm.phone.trim() || !contactForm.email.trim()) return;
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
  };

  const resetLayout = () => {
    localStorage.removeItem("consuela-home-layout");
    window.location.reload();
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
    try {
      const res = await fetch("/api/emergency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "General", timestamp: new Date().toISOString() }) });
      const data = await res.json();
      showToast(data.success ? "✅ Test alert sent" : "❌ Alert failed — check emergency contacts");
    } catch {
      showToast("❌ Could not send test alert");
    }
  };

  const [helpModalOpen, setHelpModalOpen] = useState(false);

  const exportData = () => {
    const data = {
      members,
      contacts,
      widgets,
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
                    onClick={() => {
                      setAccentColor(accent.id);
                      setAccentHex("selected", accent.hex);
                      setAccentHex("glow", accent.glow);
                      setAccentHex("button", accent.hex);
                      setAccentHex("border", accent.glow);
                    }}
                    className={`rounded-2xl border p-3 text-left transition ${
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
                    onChange={(value) => {
                      setAccentTarget(value as AccentTarget);
                      setCustomHex(value === "glow" || value === "border" ? "#3b82f6" : defaultAccentHex[value as AccentTarget]);
                    }}
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
                      value={normalizeHex(customHex)}
                      onChange={(event) => setTargetColor(accentTarget, event.target.value)}
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
                      <label className="mb-1 block text-xs font-semibold text-text-secondary">Highlight color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={fog.config.highlightColor}
                          onChange={(e) => fog.setHighlightColor(e.target.value)}
                          className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-[var(--color-surface-2)] p-1"
                        />
                        <span className="truncate text-[11px] text-text-muted">{fog.config.highlightColor}</span>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-text-secondary">Lowlight color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={fog.config.lowlightColor}
                          onChange={(e) => fog.setLowlightColor(e.target.value)}
                          className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-[var(--color-surface-2)] p-1"
                        />
                        <span className="truncate text-[11px] text-text-muted">{fog.config.lowlightColor}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-text-secondary">
                      Speed — {fog.config.speed.toFixed(1)}
                    </label>
                    <input
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
                    <label className="mb-1 block text-xs font-semibold text-text-secondary">
                      Blur — {fog.config.blurFactor.toFixed(2)}
                    </label>
                    <input
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
                      <IconButton size="sm" variant="danger" aria-label="Delete member" onClick={() => deleteMember(member)}>×</IconButton>
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
                      <IconButton size="sm" variant="danger" aria-label="Delete contact" onClick={() => deleteContact(contact)}>×</IconButton>
                    </div>
                  }
                />
              ))}
              {contacts.length === 0 && <EmptyState title="No emergency contacts" description="Add a primary contact for serious alerts." actionLabel="Add contact" onAction={() => openContactModal()} />}
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton onClick={() => openContactModal()} className="flex-1">Add contact</SoftButton>
              <SoftButton variant="secondary" onClick={testEmergencyAlert} className="flex-1">Test</SoftButton>
            </div>
          </SectionCard>

          <SectionCard
            title="Integrations"
            description="Connect external accounts to sync calendar events, tasks, and reminders."
            icon="🔗"
          >
            <GoogleConnectCard />
          </SectionCard>

          <SectionCard title="Layout & display" description="Show, hide, and reorder Home widgets." icon="🧩">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                <span>Visible</span>
                <span>{visibleWidgets.length} on Home</span>
              </div>
              {visibleWidgets.length === 0 && (
                <EmptyState
                  title="No visible widgets"
                  description="Turn on a widget from the Hidden group below to start building your Home."
                  icon="🧩"
                />
              )}
              <div className="space-y-3">
                {visibleWidgets.map((widget, index) => {
                  const isDropTarget = dropTargetId === widget.id && draggingId !== widget.id;
                  return (
                    <div
                      key={widget.id}
                      draggable
                      onDragStart={handleDragStart(widget.id)}
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
                        leading={
                          <span
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
                              checked
                              onCheckedChange={(checked) => {
                                if (!checked) handleToggle(widget.id, false);
                              }}
                              aria-label={`Hide ${widget.label}`}
                            />
                            <IconButton size="sm" variant="ghost" aria-label={`Move ${widget.label} up`} disabled={index === 0} onClick={() => handleMoveUp(widget.id)}>↑</IconButton>
                            <IconButton size="sm" variant="ghost" aria-label={`Move ${widget.label} down`} disabled={index === visibleWidgets.length - 1} onClick={() => handleMoveDown(widget.id)}>↓</IconButton>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>

              {hiddenWidgets.length > 0 && (
                <>
                  <div className="mt-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                    <span className="h-px flex-1 bg-white/10" />
                    <span>Hidden · {hiddenWidgets.length}</span>
                    <span className="h-px flex-1 bg-white/10" />
                  </div>
                  <div className="space-y-3">
                    {hiddenWidgets.map((widget) => (
                      <ListRow
                        key={widget.id}
                        title={widget.label}
                        subtitle={widget.description}
                        leftRailColor="var(--color-accent-sage)"
                        className="opacity-55"
                        leading={<span className="grid h-9 w-6 place-items-center text-text-muted" aria-hidden="true">⋮⋮</span>}
                        trailing={
                          <div className="flex items-center gap-1">
                            <Toggle
                              checked={false}
                              onCheckedChange={(checked) => {
                                if (checked) handleToggle(widget.id, true);
                              }}
                              aria-label={`Show ${widget.label}`}
                            />
                            <IconButton size="sm" variant="ghost" aria-label={`Reorder ${widget.label}`} disabled aria-disabled>
                              ↑
                            </IconButton>
                            <IconButton size="sm" variant="ghost" aria-label={`Reorder ${widget.label}`} disabled aria-disabled>
                              ↓
                            </IconButton>
                          </div>
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton variant="secondary" onClick={resetLayout} className="flex-1">Reset layout</SoftButton>
              <SoftButton variant="ghost" onClick={() => setHelpModalOpen(true)} className="flex-1">Help</SoftButton>
            </div>
          </SectionCard>

          <SectionCard title="Data & sync" description="Export or reset local settings." icon="📦">
            <div className="grid gap-3 sm:grid-cols-1">
              <Surface variant="glass-subtle" radius="xl" padding="sm">
                <div className="text-sm font-bold text-text-primary">Local settings</div>
                <p className="mt-1 text-xs text-text-secondary">Export your family members, emergency contacts, and home layout as a single JSON file. Reset is in the Layout section above.</p>
              </Surface>
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton onClick={exportData} className="flex-1">Export JSON</SoftButton>
            </div>
          </SectionCard>
        </div>

        <Modal
          open={memberModalOpen}
          onClose={() => setMemberModalOpen(false)}
          title={editingMember ? "Edit member" : "Add member"}
          description="Family members appear in avatars, tasks, and the Home row."
          footer={
            <>
              <SoftButton onClick={saveMember} className="flex-1">Save</SoftButton>
              <SoftButton variant="secondary" onClick={() => setMemberModalOpen(false)} className="flex-1">Cancel</SoftButton>
            </>
          }
        >
          <div className="space-y-4">
            <FormField label="Name">
              <input value={memberForm.name} onChange={(e) => setMemberForm((prev: any) => ({ ...prev, name: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Member name" />
            </FormField>
            <FormField label="Emoji">
              <div className="flex flex-wrap gap-2">
                {emojiOptions.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => setMemberForm((prev: any) => ({ ...prev, emoji }))} className={`grid h-10 w-10 place-items-center rounded-2xl text-lg ${memberForm.emoji === emoji ? "bg-[var(--color-accent-selected)] text-white" : "bg-[var(--color-surface-2)] text-text-primary"}`}>{emoji}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Role">
              <select value={memberForm.role} onChange={(e) => setMemberForm((prev: any) => ({ ...prev, role: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none">
                <option value="parent">Parent</option>
                <option value="child">Child</option>
                <option value="pet">Pet</option>
              </select>
            </FormField>
            <FormField label="PIN">
              <input type="password" inputMode="numeric" maxLength={4} value={memberForm.pin} onChange={(e) => setMemberForm((prev: any) => ({ ...prev, pin: e.target.value.replace(/[^0-9]/g, "") }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-center text-2xl tracking-[0.5em] text-text-primary outline-none placeholder:text-text-muted" placeholder="0000" />
            </FormField>
            <FormField label="Avatar image">
              <div className="space-y-2">
                <input
                  value={memberForm.imageUrl || ""}
                  onChange={(e) => setMemberForm((prev: any) => ({ ...prev, imageUrl: e.target.value }))}
                  className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-xs text-text-primary outline-none font-mono"
                  placeholder="Paste image URL or data:image/..."
                />
                {memberForm.imageUrl && memberForm.imageUrl.startsWith("data:") && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-text-muted">Preview:</span>
                    <Avatar name={memberForm.name || "Preview"} color="green" emoji={memberForm.imageUrl} size="sm" variant="emoji" />
                  </div>
                )}
              </div>
            </FormField>
            <div className="flex items-center justify-between">
              <FormField label="Avatar size">
                <div className="flex gap-1.5">
                  {(["xs", "sm", "md", "lg"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setMemberForm((prev: any) => ({ ...prev, avatarSize: s }))}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
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
            <FormField label="Name">
              <input value={contactForm.name} onChange={(e) => setContactForm((prev: any) => ({ ...prev, name: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="Contact name" />
            </FormField>
            <FormField label="Phone">
              <input value={contactForm.phone} onChange={(e) => setContactForm((prev: any) => ({ ...prev, phone: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="+15551234567" />
            </FormField>
            <FormField label="Email">
              <input value={contactForm.email} onChange={(e) => setContactForm((prev: any) => ({ ...prev, email: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none" placeholder="name@example.com" />
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

        <Modal open={helpModalOpen} onClose={() => setHelpModalOpen(false)} title="Layout & display help" description="Control which widgets appear on your Home dashboard." footer={<SoftButton variant="secondary" onClick={() => setHelpModalOpen(false)} className="flex-1">Got it</SoftButton>}>
          <div className="space-y-4 text-sm text-text-secondary">
            <p><strong className="text-text-primary">Show / Hide</strong> — Toggle each widget on or off. Hidden widgets move to the <em>Hidden</em> group at the bottom of this list and stop appearing on the Home dashboard.</p>
            <p><strong className="text-text-primary">Reorder</strong> — Drag the ⋮⋮ handle onto another visible row, or use the ↑ and ↓ buttons. The first row appears first on the Home dashboard.</p>
            <p><strong className="text-text-primary">Reset layout</strong> — Restores all widgets to their default order and visibility.</p>
          </div>
        </Modal>
      </SettingsErrorBoundary>
    </PageShell>
  );
}
