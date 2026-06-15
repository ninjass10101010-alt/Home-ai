"use client";

import { useState, useMemo } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useAuth } from "@/hooks/useAuth";
import { ALL_WIDGETS, type WidgetId } from "@/lib/layout-config";
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
import { warmGlassAccentOptions } from "@/lib/design-tokens";
import { defaultAccentHex, type AccentTarget } from "@/lib/theme-config";

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
  const { widgets, toggle, moveUp, moveDown } = useHomeLayout();
  const { currentUser, isLoggedIn, logout } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [accentTarget, setAccentTarget] = useState<AccentTarget>("selected");
  const [customHex, setCustomHex] = useState(defaultAccentHex[accentTarget]);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [editingContact, setEditingContact] = useState<any | null>(null);
  const [memberForm, setMemberForm] = useState<any>({ name: "", emoji: "😊", role: "child", pin: "" });
  const [contactForm, setContactForm] = useState<any>({ name: "", phone: "", email: "", relationship: "parent", isPrimary: false, emoji: "👤" });

  const members = useMemo(() => db.selectMembersDetailed(), []);
  const contacts = useMemo(() => db.selectEmergencyContacts(), []);
  const profileMember = currentUser
    ? members.find((m: any) => m.name === currentUser.name || m.fullName === currentUser.name) || members[0]
    : members[0];

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
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
    setMemberForm(member || { name: "", emoji: "😊", role: "child", pin: "" });
    setMemberModalOpen(true);
  };

  const saveMember = () => {
    if (!memberForm.name.trim()) return;
    if (editingMember) {
      db.updateMember(editingMember.name, { ...memberForm, name: memberForm.name.trim() });
      showToast(`✅ Updated ${memberForm.name.trim()}`);
    } else {
      db.insertMember({ ...memberForm, name: memberForm.name.trim(), joined: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }) });
      showToast(`✅ Added ${memberForm.name.trim()}`);
    }
    setMemberModalOpen(false);
  };

  const deleteMember = (member: any) => {
    db.deleteMember(member.name);
    showToast(`🗑️ Removed ${member.name}`);
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
    setContactModalOpen(false);
  };

  const deleteContact = (contact: any) => {
    db.deleteEmergencyContact(contact.id);
    showToast(`🗑️ Removed ${contact.name}`);
  };

  const resetLayout = () => {
    localStorage.removeItem("consuela-home-layout");
    window.location.reload();
  };

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
              <SoftButton variant="secondary" onClick={() => {}} className="flex-1">Invite</SoftButton>
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
              <SoftButton variant="secondary" onClick={() => {}} className="flex-1">Test</SoftButton>
            </div>
          </SectionCard>

          <SectionCard title="Layout & display" description="Show, hide, and reorder Home widgets." icon="🧩">
            <div className="space-y-3">
              {ALL_WIDGETS.map((widget, index) => (
                <ListRow
                  key={widget.id}
                  title={widget.label}
                  subtitle={widget.description}
                  leftRailColor="var(--color-accent-sage)"
                  leading={<span className="text-xl">{widget.emoji}</span>}
                  trailing={
                    <div className="flex items-center gap-1">
                      <Toggle checked={widgets.includes(widget.id)} onCheckedChange={() => toggle(widget.id)} />
                      <IconButton size="sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => moveUp(widget.id)}>↑</IconButton>
                      <IconButton size="sm" variant="ghost" aria-label="Move down" disabled={index === ALL_WIDGETS.length - 1} onClick={() => moveDown(widget.id)}>↓</IconButton>
                    </div>
                  }
                />
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton variant="secondary" onClick={resetLayout} className="flex-1">Reset layout</SoftButton>
              <SoftButton variant="ghost" onClick={() => {}} className="flex-1">Help</SoftButton>
            </div>
          </SectionCard>

          <SectionCard title="Data & sync" description="Export or reset local settings." icon="📦">
            <div className="grid gap-3 sm:grid-cols-2">
              <Surface variant="glass-subtle" radius="xl" padding="sm">
                <div className="text-sm font-bold text-text-primary">Local settings</div>
                <p className="mt-1 text-xs text-text-secondary">Export your family members, emergency contacts, and home layout.</p>
              </Surface>
              <Surface variant="glass-subtle" radius="xl" padding="sm">
                <div className="text-sm font-bold text-text-primary">Reset</div>
                <p className="mt-1 text-xs text-text-secondary">Clear local layout settings and reload the page.</p>
              </Surface>
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton onClick={exportData} className="flex-1">Export JSON</SoftButton>
              <SoftButton variant="danger" onClick={resetLayout} className="flex-1">Reset layout</SoftButton>
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
      </SettingsErrorBoundary>
    </PageShell>
  );
}
