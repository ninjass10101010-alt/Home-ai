"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useWeatherConfig } from "@/hooks/useWeather";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { ALL_WIDGETS } from "@/lib/layout-config";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import AnimatedEmoji from "@/components/ui/AnimatedEmoji";
import SigmaImage from "@/components/ui/SigmaImage";
import { db } from "@/db";

const emojiOptions = ["👨","👩","👧","🧒","👶","👴","👵","🐶","🐱","🐩","🐕","🐈","🐠","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵"];

const carrierOptions = [
  { id: "att", label: "AT&T", gateway: "@txt.att.net" },
  { id: "verizon", label: "Verizon", gateway: "@vtext.com" },
  { id: "tmobile", label: "T-Mobile", gateway: "@tmomail.net" },
  { id: "sprint", label: "Sprint", gateway: "@messaging.sprintpcs.com" },
  { id: "virgin", label: "Virgin Mobile", gateway: "@vmobl.com" },
  { id: "cricket", label: "Cricket", gateway: "@sms.cricketwireless.net" },
  { id: "metropcs", label: "MetroPCS", gateway: "@mymetropcs.com" },
  { id: "straighttalk", label: "Straight Talk", gateway: "@vtext.com" },
  { id: "boost", label: "Boost Mobile", gateway: "@sms.myboostmobile.com" },
];

const relationshipOptions = [
  { id: "parent", label: "Parent", icon: "👨‍👩‍👧" },
  { id: "guardian", label: "Guardian", icon: "🛡️" },
  { id: "grandparent", label: "Grandparent", icon: "👴" },
  { id: "neighbor", label: "Neighbor", icon: "🏠" },
  { id: "other", label: "Other", icon: "👤" },
];

export default function SettingsPage() {
  const { theme, setMode, setAccentColor, setContrastBoost } = useTheme();
  const { weather, setLocation, setUnit, setTimeOfDay, setSeason, setHolidayOverride } = useWeatherConfig();
  const { widgets, moveUp, moveDown, toggle, getIndex } = useHomeLayout();
  const [mounted, setMounted] = useState(false);

  // ─── Family Member editing state ────────────────────────────────────────
  const [membersList, setMembersList] = useState<any[]>([]);
  const [editingMemberIdx, setEditingMemberIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [editAge, setEditAge] = useState("");
  const [editPin, setEditPin] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // ─── Emergency Contacts editing state ────────────────────────────────────
  const [emergencyList, setEmergencyList] = useState<any[]>([]);
  const [editingEmergencyIdx, setEditingEmergencyIdx] = useState<number | null>(null);
  const [addingEmergency, setAddingEmergency] = useState(false);
  const [editECName, setEditECName] = useState("");
  const [editECPhone, setEditECPhone] = useState("");
  const [editECEmail, setEditECEmail] = useState("");
  const [editECCarrier, setEditECCarrier] = useState("att");
  const [editECRelationship, setEditECRelationship] = useState("parent");
  const [editECIsPrimary, setEditECIsPrimary] = useState(true);
  const [editECEmoji, setEditECEmoji] = useState("👤");
  const [showECEmojiPicker, setShowECEmojiPicker] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Load family members from localStorage, fallback to DB seed
    const storedMembers = (() => {
      if (typeof window === "undefined") return null;
      try { const d = localStorage.getItem("consuela-members"); return d ? JSON.parse(d) : null; } catch { return null; }
    })();
    if (storedMembers && storedMembers.length > 0) {
      storedMembers.forEach((m: any) => {
        const exists = db.selectMembersDetailed().find((em: any) => em.name === m.name);
        if (exists) db.updateMember(m.name, { emoji: m.emoji, name: m.name, age: parseInt(m.age) || 0, pin: m.pin || "" });
      });
      setMembersList(storedMembers);
    } else {
      setMembersList(db.selectMembersDetailed());
    }
    // Load emergency contacts from localStorage, fallback to DB seed
    const stored = (() => {
      if (typeof window === "undefined") return null;
      try { const d = localStorage.getItem("consuela-emergency"); return d ? JSON.parse(d) : null; } catch { return null; }
    })();
    if (stored && stored.length > 0) {
      // Seed DB from localStorage
      stored.forEach((c: any) => {
        const exists = db.selectEmergencyContacts().find((ec: any) => ec.id === c.id);
        if (!exists) db.insertEmergencyContact(c);
        else db.updateEmergencyContact(c.id, c);
      });
      setEmergencyList(stored);
    } else {
      setEmergencyList(db.selectEmergencyContacts());
    }
  }, []);

  // Persist family members to localStorage on every change
  useEffect(() => {
    if (mounted && membersList.length > 0) {
      localStorage.setItem("consuela-members", JSON.stringify(membersList));
    }
  }, [membersList, mounted]);

  // Persist emergency contacts to localStorage on every change
  useEffect(() => {
    if (mounted && emergencyList.length > 0) {
      localStorage.setItem("consuela-emergency", JSON.stringify(emergencyList));
    }
  }, [emergencyList, mounted]);

  const startEditMember = (idx: number, member: any) => {
    setEditingMemberIdx(idx);
    setEditName(member.name);
    setEditEmoji(member.emoji);
    setEditAge(member.age || "");
    setEditPin(member.pin || "");
  };

  const saveMember = (idx: number) => {
    const member = membersList[idx];
    if (!member || !editName.trim()) return;
    db.updateMember(member.name, { name: editName.trim(), emoji: editEmoji, age: parseInt(editAge) || 0, pin: editPin });
    setMembersList(prev => prev.map((m, i) => i === idx ? { ...m, name: editName.trim(), emoji: editEmoji, age: editAge, pin: editPin } : m));
    setEditingMemberIdx(null);
  };

  // ─── Emergency Contacts CRUD ─────────────────────────────────────────
  const startEditEmergency = (idx: number) => {
    setAddingEmergency(false);
    setEditingEmergencyIdx(idx);
    const c = emergencyList[idx];
    setEditECName(c.name);
    setEditECPhone(c.phone);
    setEditECEmail(c.email);
    setEditECCarrier(c.carrier || "att");
    setEditECRelationship(c.relationship || "parent");
    setEditECIsPrimary(c.isPrimary);
    setEditECEmoji(c.emoji || "👤");
  };

  const startAddEmergency = () => {
    setEditingEmergencyIdx(null);
    setAddingEmergency(true);
    setEditECName("");
    setEditECPhone("");
    setEditECEmail("");
    setEditECCarrier("att");
    setEditECRelationship("parent");
    setEditECIsPrimary(true);
    setEditECEmoji("👤");
  };

  const saveEmergency = (idx: number | null) => {
    if (!editECName.trim() || !editECPhone.trim()) return;
    if (idx !== null) {
      // Update existing
      const contact = emergencyList[idx];
      db.updateEmergencyContact(contact.id, {
        name: editECName.trim(),
        phone: editECPhone.trim(),
        email: editECEmail.trim(),
        carrier: editECCarrier,
        relationship: editECRelationship as any,
        isPrimary: editECIsPrimary,
        emoji: editECEmoji,
      });
      setEmergencyList(prev => prev.map((c, i) => i === idx ? {
        ...c,
        name: editECName.trim(),
        phone: editECPhone.trim(),
        email: editECEmail.trim(),
        carrier: editECCarrier,
        relationship: editECRelationship,
        isPrimary: editECIsPrimary,
        emoji: editECEmoji,
      } : c));
      setEditingEmergencyIdx(null);
    } else {
      // Add new
      const newContact = db.insertEmergencyContact({
        name: editECName.trim(),
        phone: editECPhone.trim(),
        email: editECEmail.trim(),
        carrier: editECCarrier,
        relationship: editECRelationship as any,
        isPrimary: editECIsPrimary,
        emoji: editECEmoji,
      });
      setEmergencyList(prev => [...prev, newContact]);
      setAddingEmergency(false);
    }
  };

  const deleteEmergency = (idx: number) => {
    const contact = emergencyList[idx];
    db.deleteEmergencyContact(contact.id);
    setEmergencyList(prev => prev.filter((_, i) => i !== idx));
    if (editingEmergencyIdx === idx) {
      setEditingEmergencyIdx(null);
    }
  };

  const cancelEmergency = () => {
    setEditingEmergencyIdx(null);
    setAddingEmergency(false);
  };

  const [locationDraft, setLocationDraft] = useState("");
  const [locationSaved, setLocationSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep draft in sync with stored location after mount
  useEffect(() => {
    if (mounted) setLocationDraft(weather.location);
  }, [mounted, weather.location]);

  const handleLocationSave = () => {
    const trimmed = locationDraft.trim();
    if (!trimmed) return;
    setLocation(trimmed);
    setLocationSaved(true);
    setTimeout(() => setLocationSaved(false), 2000);
    inputRef.current?.blur();
  };

  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleLocationSave();
    if (e.key === "Escape") {
      setLocationDraft(weather.location);
      inputRef.current?.blur();
    }
  };

  // ─── Theme state ─────────────────────────────────────────────────────────
  const mode = theme.mode;
  const accentColor = theme.accentColor;
  const contrastBoost = theme.contrastBoost;

  const accentOptions = [
    { id: "nori",    label: "Nori",    dark: "#3b82f6", light: "#2563eb" },
    { id: "violet",  label: "Violet",  dark: "#7c6ff7", light: "#7c3aed" },
    { id: "rose",    label: "Rose",    dark: "#f43f5e", light: "#e11d48" },
    { id: "coral",   label: "Coral",   dark: "#fb7185", light: "#e11d48" },
    { id: "lavender",label: "Lavender",dark: "#a78bfa", light: "#6d28d9" },
    { id: "cyan",    label: "Cyan",    dark: "#06b6d4", light: "#0891b2" },
    { id: "mint",    label: "Mint",    dark: "#4ade80", light: "#059669" },
    { id: "amber",   label: "Amber",   dark: "#f59e0b", light: "#d97706" },
  ] as const;

  if (!mounted) {
    return null;
  }

  return (
    <PageShell>
      <TopBar title="Settings" subtitle="Customize your Consuela experience" />

      <div className="px-4 py-6 space-y-10">

        {/* ── Weather Widget ───────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <h2 className="text-text-primary font-semibold text-2xl">Weather Widget</h2>
            <p className="text-text-secondary mt-1">Customize your home-screen weather display</p>
          </div>

          {/* Location */}
          <div className="space-y-3">
            <h3 className="text-text-primary font-semibold">Location</h3>
            <p className="text-text-secondary text-sm">
              Enter a city, ZIP code, or address to show local weather
            </p>

            <div className="flex gap-2 items-stretch">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <input
                  ref={inputRef}
                  id="weather-location-input"
                  type="text"
                  value={locationDraft}
                  onChange={(e) => setLocationDraft(e.target.value)}
                  onKeyDown={handleLocationKeyDown}
                  placeholder="e.g. San Francisco, CA"
                  className="
                    w-full pl-9 pr-4 py-3 rounded-xl text-sm
                    bg-[var(--color-surface-2)]
                    border border-[var(--color-surface-3)]
                    text-text-primary placeholder:text-text-muted
                    focus:outline-none focus:border-[var(--color-accent-selected)]
                    focus:ring-2 focus:ring-[var(--color-accent-selected)]/20
                    transition-all duration-200
                  "
                />
              </div>
              <button
                onClick={handleLocationSave}
                disabled={!locationDraft.trim() || locationDraft.trim() === weather.location}
                className={`
                  px-4 py-3 rounded-xl text-sm font-semibold shrink-0
                  transition-all duration-200 active:scale-95
                  ${locationSaved
                    ? "bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)] border border-[var(--color-accent-mint)]/30"
                    : locationDraft.trim() && locationDraft.trim() !== weather.location
                      ? "bg-[var(--color-accent-selected)] text-white hover:opacity-90"
                      : "bg-[var(--color-surface-3)] text-text-muted cursor-not-allowed"
                  }
                `}
                aria-label="Save location"
              >
                {locationSaved ? (
                  <span className="flex items-center gap-1.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Saved
                  </span>
                ) : (
                  "Save"
                )}
              </button>
            </div>

            {/* Current saved location badge */}
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent-selected)]">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span>Currently showing: <span className="text-text-secondary font-medium">{weather.location}</span></span>
            </div>
          </div>

          {/* Temperature Unit */}
          <div className="space-y-3">
            <h3 className="text-text-primary font-semibold">Temperature Unit</h3>
            <p className="text-text-secondary text-sm">Choose how temperatures are displayed</p>

            <div className="flex gap-3">
              {(["F", "C"] as const).map((u) => (
                <button
                  key={u}
                  id={`unit-${u}`}
                  onClick={() => setUnit(u)}
                  className={`
                    flex-1 py-4 rounded-xl border-2 text-sm font-semibold
                    transition-all duration-200 active:scale-95
                    ${weather.unit === u
                      ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10 text-[var(--color-accent-selected)]"
                      : "border-[var(--color-surface-3)] text-text-secondary hover:border-[var(--color-surface-5)] hover:text-text-primary"
                    }
                  `}
                >
                  <span className="text-xl block mb-1">
                    {u === "F" ? "🌡️" : "❄️"}
                  </span>
                  °{u} — {u === "F" ? "Fahrenheit" : "Celsius"}
                </button>
              ))}
            </div>
          </div>

          {/* Time of Day */}
          <div className="space-y-3">
            <h3 className="text-text-primary font-semibold">Time of Day</h3>
            <p className="text-text-secondary text-sm">Force day/night or auto-sync with system</p>
            <div className="flex gap-3">
              {(["auto", "day", "night"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeOfDay(t)}
                  className={`
                    flex-1 py-3 rounded-xl border-2 text-sm font-semibold capitalize
                    transition-all duration-200 active:scale-95
                    ${weather.timeOfDay === t
                      ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10 text-[var(--color-accent-selected)]"
                      : "border-[var(--color-surface-3)] text-text-secondary hover:border-[var(--color-surface-5)] hover:text-text-primary"
                    }
                  `}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Season */}
          <div className="space-y-3">
            <h3 className="text-text-primary font-semibold">Season</h3>
            <p className="text-text-secondary text-sm">Force specific season visuals or auto-sync</p>
            <div className="grid grid-cols-3 gap-3">
              {([
                { id: "auto", label: "Auto", emoji: "🔄" },
                { id: "spring", label: "Spring", emoji: "🌸" },
                { id: "summer", label: "Summer", emoji: "☀️" },
                { id: "autumn", label: "Autumn", emoji: "🍂" },
                { id: "winter", label: "Winter", emoji: "❄️" },
              ] as const).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSeason(s.id)}
                  className={`
                    py-3 rounded-xl border-2 text-sm font-semibold capitalize flex flex-col items-center gap-1
                    transition-all duration-200 active:scale-95 ${s.id === "auto" ? "col-span-3 flex-row justify-center gap-2" : ""}
                    ${weather.season === s.id
                      ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10 text-[var(--color-accent-selected)]"
                      : "border-[var(--color-surface-3)] text-text-secondary hover:border-[var(--color-surface-5)] hover:text-text-primary"
                    }
                  `}
                >
                  <span className="text-lg">{s.emoji}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Holiday / Special Event Theme */}
          <div className="space-y-3">
            <h3 className="text-text-primary font-semibold">🎉 Holiday / Event Theme</h3>
            <p className="text-text-secondary text-sm">
              Auto-detects nearby holidays or force a specific festive look
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: "auto",       label: "Auto-detect",    emoji: "✨", desc: "Syncs to upcoming holidays" },
                { id: "none",       label: "None",           emoji: "🚫", desc: "Season only, no holiday" },
                { id: "christmas",  label: "Christmas",      emoji: "🎄", desc: "Lights, snow & warm glow" },
                { id: "halloween",  label: "Halloween",      emoji: "🎃", desc: "Spooky mist & bats" },
                { id: "july4th",    label: "4th of July",    emoji: "🎆", desc: "Fireworks & patriotic" },
                { id: "valentines", label: "Valentine's",    emoji: "💝", desc: "Hearts & rose glow" },
                { id: "newyears",   label: "New Year's",     emoji: "🥂", desc: "Midnight sparkles" },
                { id: "cincodemayo",label: "Cinco de Mayo",  emoji: "🪅", desc: "Piñatas & festive colors" },
                { id: "thanksgiving",label: "Thanksgiving",  emoji: "🦃", desc: "Fall harvest & warm tones" },
                { id: "stpatricks", label: "St. Patrick's",  emoji: "☘️", desc: "Green magic & leprechauns" },
              ] as const).map((h) => (
                <button
                  key={h.id}
                  onClick={() => setHolidayOverride(h.id)}
                  className={`
                    py-3 px-3 rounded-xl border-2 text-left
                    transition-all duration-200 active:scale-95
                    ${h.id === "auto" || h.id === "none" ? "col-span-1" : ""}
                    ${weather.holidayOverride === h.id
                      ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10"
                      : "border-[var(--color-surface-3)] hover:border-[var(--color-surface-5)]"
                    }
                  `}
                >
                  <span className="text-2xl block mb-1">{h.emoji}</span>
                  <p className={`text-sm font-semibold ${weather.holidayOverride === h.id ? "text-[var(--color-accent-selected)]" : "text-text-primary"}`}>{h.label}</p>
                  <p className="text-text-muted text-xs mt-0.5">{h.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview */}
          <div className="space-y-3">
            <h3 className="text-text-primary font-semibold">Preview</h3>
            <Card className="!p-4">
              <div className="flex items-center gap-2 text-text-secondary text-xs font-medium mb-3">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent-selected)]">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="truncate">{weather.location}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-4xl">⛅</span>
                <div>
                  <p className="text-text-primary text-2xl font-bold leading-tight">
                    {weather.unit === "C" ? "22°" : "72°"}
                    <span className="text-text-muted text-base font-normal">/{weather.unit}</span>
                  </p>
                  <p className="text-text-secondary text-xs mt-0.5">Partly Cloudy · Feels like {weather.unit === "C" ? "23°" : "74°"}</p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        <div className="h-px bg-[var(--color-surface-3)]" />

        {/* ── Theme & Appearance ───────────────────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <h2 className="text-text-primary font-semibold text-2xl">Theme & Appearance</h2>
            <p className="text-text-secondary mt-1">Customize how Consuela looks to you</p>
          </div>

          {/* Display Mode */}
          <div className="space-y-4">
            <h3 className="text-text-primary font-semibold">Display Mode</h3>
            <p className="text-text-secondary text-sm">Choose how the app appears</p>

            <div className="space-y-3">
              {/* Light Mode */}
              <label className="flex items-center cursor-pointer rounded-xl border border-[var(--color-surface-3)] p-4 hover:border-[var(--color-accent-selected)]/50 hover:bg-[var(--color-accent-selected)]/5 transition-[border-color,background-color] duration-200">
                <input type="radio" name="displayMode" checked={mode === "light"} onChange={() => setMode("light")} className="sr-only" />
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-xl">☀️</span>
                    <div>
                      <p className="text-text-primary font-semibold">Light Mode</p>
                      <p className="text-text-secondary text-xs">Best for daytime and bright spaces</p>
                    </div>
                  </div>
                  <div className="shrink-0 w-5 h-5 rounded-full border-2 border-[var(--color-surface-4)] flex items-center justify-center">
                    {mode === "light" && <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent-selected)]" />}
                  </div>
                </div>
              </label>

              {/* System */}
              <label className="flex items-center cursor-pointer rounded-xl border border-[var(--color-surface-3)] p-4 hover:border-[var(--color-accent-selected)]/50 hover:bg-[var(--color-accent-selected)]/5 transition-[border-color,background-color] duration-200">
                <input type="radio" name="displayMode" checked={mode === "system"} onChange={() => setMode("system")} className="sr-only" />
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-xl">⚙️</span>
                    <div>
                      <p className="text-text-primary font-semibold">🌅 Smart Auto (Default)</p>
                      <p className="text-text-secondary text-xs">Light by day, dark by night — based on actual daylight</p>
                    </div>
                  </div>
                  <div className="shrink-0 w-5 h-5 rounded-full border-2 border-[var(--color-surface-4)] flex items-center justify-center">
                    {mode === "system" && <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent-selected)]" />}
                  </div>
                </div>
              </label>

              {/* Dark Mode */}
              <label className="flex items-center cursor-pointer rounded-xl border border-[var(--color-surface-3)] p-4 hover:border-[var(--color-accent-selected)]/50 hover:bg-[var(--color-accent-selected)]/5 transition-[border-color,background-color] duration-200">
                <input type="radio" name="displayMode" checked={mode === "dark"} onChange={() => setMode("dark")} className="sr-only" />
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-xl">🌙</span>
                    <div>
                      <p className="text-text-primary font-semibold">Dark Mode</p>
                      <p className="text-text-secondary text-xs">Best for evening and low-light</p>
                    </div>
                  </div>
                  <div className="shrink-0 w-5 h-5 rounded-full border-2 border-[var(--color-surface-4)] flex items-center justify-center">
                    {mode === "dark" && <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent-selected)]" />}
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Accent Color */}
          <div className="space-y-4">
            <h3 className="text-text-primary font-semibold">Accent Color</h3>
            <p className="text-text-secondary text-sm">Choose your primary highlight color</p>

            <div className="flex flex-wrap gap-3">
              {accentOptions.map((option) => (
                <label key={option.id} className="flex items-center cursor-pointer gap-2">
                  <input type="radio" name="accentColor" checked={accentColor === option.id} onChange={() => setAccentColor(option.id)} className="sr-only" />
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-xl transition-[background-color,transform,border-color] duration-200 border-2 ${
                        accentColor === option.id
                          ? "border-[var(--color-accent-selected)] scale-105"
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{
                        backgroundColor: `var(--color-accent-${option.id})`,
                        boxShadow: accentColor === option.id ? `0 0 12px var(--color-accent-${option.id})` : "none",
                      }}
                    />
                    <p className="text-xs text-text-secondary mt-1 capitalize">{option.label}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-4">
            <h3 className="text-text-primary font-semibold">Preview</h3>
            <p className="text-text-secondary text-sm">Your Consuela will look like:</p>

            <Card className="aspect-[3/2]">
              <div className="p-6 space-y-4">
                <p className="text-text-primary">This text uses your current colors</p>
                <p className="text-text-muted">Background: Your selected theme</p>
                <Button variant="primary" className="w-fit">
                  Accent Color Button
                </Button>
                <p className="text-text-xs text-text-muted mt-2">Changes apply instantly (no reload)</p>
              </div>
            </Card>
          </div>

          {/* High Contrast */}
          <div className="space-y-4">
            <h3 className="text-text-primary font-semibold">High Contrast Mode</h3>
            <p className="text-text-secondary text-sm">Improve readability with stronger contrasts</p>

            <label className="flex items-center cursor-pointer gap-3 p-4 rounded-xl border border-[var(--color-surface-3)] hover:border-[var(--color-accent-selected)]/50 transition-all duration-200">
              <input
                type="checkbox"
                checked={contrastBoost}
                onChange={(e) => setContrastBoost(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`relative w-10 h-6 rounded-full shrink-0 transition-colors duration-200 ${
                  contrastBoost ? "bg-[var(--color-accent-selected)]" : "bg-[var(--color-surface-4)]"
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                    contrastBoost ? "left-5" : "left-1"
                  }`}
                />
              </div>
              <span className="text-text-primary">Enable high contrast mode</span>
            </label>
          </div>
        </section>

        <div className="h-px bg-[var(--color-surface-3)]" />

        {/* ── Family Members ──────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <h2 className="text-text-primary font-semibold text-2xl">Family Members</h2>
            <p className="text-text-secondary mt-1">Edit names, emojis, and colors</p>
          </div>

          <div className="space-y-3">
            {membersList.map((member: any, idx: number) => {
              const isEditing = editingMemberIdx === idx;
              return (
                <div key={member.name} className="flex items-center gap-3 p-4 rounded-xl border border-[var(--color-surface-3)] bg-[var(--color-surface-1)]">
                  {isEditing ? (
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className="w-12 h-12 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center text-2xl hover:bg-[var(--color-surface-3)] transition-colors"
                        >
                          {editEmoji}
                        </button>
                        <input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="flex-1 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)]"
                          autoFocus
                        />
                      </div>
                      <input
                        value={editEmoji}
                        onChange={e => { const v = e.target.value; if (v !== "") setEditEmoji(v); }}
                        placeholder="Paste emoji or GIF URL..."
                        className="w-full bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)] placeholder:text-text-muted"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          value={editAge}
                          onChange={e => setEditAge(e.target.value.replace(/[^0-9]/g, ""))}
                          placeholder="Age"
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          className="w-20 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)] placeholder:text-text-muted"
                        />
                        <span className="text-text-muted text-xs">years old</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          value={editPin}
                          onChange={e => setEditPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                          placeholder="PIN"
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          className="w-24 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)] placeholder:text-text-muted"
                        />
                        <span className="text-text-muted text-xs">4-digit PIN</span>
                      </div>
                      {showEmojiPicker && (
                        <div className="flex flex-wrap gap-1 p-2 rounded-xl bg-[var(--color-surface-2)]">
                          {emojiOptions.map(e => (
                            <button key={e} onClick={() => { setEditEmoji(e); setShowEmojiPicker(false); }}
                              className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center hover:bg-[var(--color-accent-selected)]/20 transition-all ${editEmoji === e ? "bg-[var(--color-accent-selected)]/20" : ""}`}
                            >{e}</button>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => saveMember(idx)}
                          className="px-4 py-2 rounded-xl bg-[var(--color-accent-selected)] text-white text-xs font-semibold">Save</button>
                        <button onClick={() => setEditingMemberIdx(null)}
                          className="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] text-text-secondary text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center text-2xl shrink-0 overflow-hidden">
                        {member.emoji && (member.emoji.startsWith("http") || member.emoji.startsWith("//")) ? (
                          <SigmaImage src={member.emoji} alt={member.name} shape="rounded" />
                        ) : (
                          <span>{member.emoji || "👤"}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-sm font-semibold truncate">{member.name}</p>
                        <p className="text-text-muted text-xs">{member.role} · {member.age}y{member.pin && member.role !== "Pet" ? ` · PIN: ${member.pin}` : ""}</p>
                      </div>
                      <button
                        onClick={() => startEditMember(idx, member)}
                        className="px-3 py-2 rounded-xl glass text-text-secondary text-xs font-medium hover:text-text-primary transition-colors"
                      >
                        ✏️ Edit
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="h-px bg-[var(--color-surface-3)]" />

        {/* ── Emergency Contacts ───────────────────────────────────────────── */}
        <section className="space-y-6" id="emergency">
          <div>
            <h2 className="text-text-primary font-semibold text-2xl">Emergency Contacts</h2>
            <p className="text-text-secondary mt-1">
              Contacts used for SMS/email alerts. Uses free Gmail-to-SMS gateways.
            </p>
          </div>

          <div className="space-y-3">
            {emergencyList.map((contact: any, idx: number) => {
              const isEditing = editingEmergencyIdx === idx;
              return (
                <div key={contact.id} className="flex items-center gap-3 p-4 rounded-xl border border-[var(--color-surface-3)] bg-[var(--color-surface-1)]">
                  {isEditing ? (
                    <div className="flex-1 space-y-3">
                      {/* Emoji + Name */}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setShowECEmojiPicker(!showECEmojiPicker)}
                          className="w-12 h-12 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center text-2xl hover:bg-[var(--color-surface-3)] transition-colors shrink-0"
                        >
                          {editECEmoji}
                        </button>
                        <input
                          value={editECName}
                          onChange={e => setEditECName(e.target.value)}
                          placeholder="Contact name"
                          className="flex-1 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)]"
                          autoFocus
                        />
                      </div>

                      {/* Emoji picker */}
                      {showECEmojiPicker && (
                        <div className="flex flex-wrap gap-1 p-2 rounded-xl bg-[var(--color-surface-2)]">
                          {emojiOptions.map(e => (
                            <button key={e} onClick={() => { setEditECEmoji(e); setShowECEmojiPicker(false); }}
                              className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center hover:bg-[var(--color-accent-selected)]/20 transition-all ${editECEmoji === e ? "bg-[var(--color-accent-selected)]/20" : ""}`}
                            >{e}</button>
                          ))}
                        </div>
                      )}

                      {/* Phone */}
                      <input
                        value={editECPhone}
                        onChange={e => setEditECPhone(e.target.value)}
                        placeholder="Phone (+15551234567)"
                        type="tel"
                        className="w-full bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)] placeholder:text-text-muted"
                      />

                      {/* Email */}
                      <input
                        value={editECEmail}
                        onChange={e => setEditECEmail(e.target.value)}
                        placeholder="Email address"
                        type="email"
                        className="w-full bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)] placeholder:text-text-muted"
                      />

                      {/* Carrier + Relationship row */}
                      <div className="flex gap-2">
                        <select
                          value={editECCarrier}
                          onChange={e => setEditECCarrier(e.target.value)}
                          className="flex-1 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)]"
                        >
                          {carrierOptions.map(c => (
                            <option key={c.id} value={c.id}>{c.label} ({c.gateway})</option>
                          ))}
                        </select>
                        <select
                          value={editECRelationship}
                          onChange={e => setEditECRelationship(e.target.value)}
                          className="flex-1 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)]"
                        >
                          {relationshipOptions.map(r => (
                            <option key={r.id} value={r.id}>{r.icon} {r.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Primary toggle */}
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editECIsPrimary}
                          onChange={e => setEditECIsPrimary(e.target.checked)}
                          className="sr-only"
                        />
                        <div className={`relative w-10 h-6 rounded-full shrink-0 transition-colors duration-200 ${editECIsPrimary ? "bg-rose-500" : "bg-[var(--color-surface-4)]"}`}>
                          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${editECIsPrimary ? "left-5" : "left-1"}`} />
                        </div>
                        <span className="text-text-primary text-sm">Primary contact (receives emergency alerts)</span>
                      </label>

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <button onClick={() => saveEmergency(idx)}
                          className="px-4 py-2 rounded-xl bg-[var(--color-accent-selected)] text-white text-xs font-semibold">Save</button>
                        <button onClick={cancelEmergency}
                          className="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] text-text-secondary text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center text-2xl shrink-0 overflow-hidden">
                        <span>{contact.emoji || "👤"}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-text-primary text-sm font-semibold truncate">{contact.name}</p>
                          {contact.isPrimary && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-medium">Primary</span>
                          )}
                        </div>
                        <p className="text-text-muted text-xs">{contact.phone}</p>
                        <p className="text-text-muted text-[10px]">
                          {contact.email} · {carrierOptions.find(c => c.id === contact.carrier)?.label || "Unknown carrier"}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => startEditEmergency(idx)}
                          className="px-3 py-2 rounded-xl glass text-text-secondary text-xs font-medium hover:text-text-primary transition-colors"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => deleteEmergency(idx)}
                          className="px-3 py-2 rounded-xl glass text-rose-400 text-xs font-medium hover:text-rose-300 transition-colors"
                        >
                          🗑️
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Add new emergency contact form */}
            {addingEmergency && (
              <div className="p-4 rounded-xl border-2 border-dashed border-[var(--color-accent-selected)]/50 bg-[var(--color-surface-1)] space-y-3">
                <p className="text-text-primary text-sm font-semibold">New Emergency Contact</p>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowECEmojiPicker(!showECEmojiPicker)}
                    className="w-12 h-12 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center text-2xl hover:bg-[var(--color-surface-3)] transition-colors shrink-0"
                  >
                    {editECEmoji || "👤"}
                  </button>
                  <input
                    value={editECName}
                    onChange={e => setEditECName(e.target.value)}
                    placeholder="Contact name"
                    className="flex-1 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)]"
                    autoFocus
                  />
                </div>

                {showECEmojiPicker && (
                  <div className="flex flex-wrap gap-1 p-2 rounded-xl bg-[var(--color-surface-2)]">
                    {emojiOptions.map(e => (
                      <button key={e} onClick={() => { setEditECEmoji(e); setShowECEmojiPicker(false); }}
                        className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center hover:bg-[var(--color-accent-selected)]/20 transition-all ${editECEmoji === e ? "bg-[var(--color-accent-selected)]/20" : ""}`}
                      >{e}</button>
                    ))}
                  </div>
                )}

                <input
                  value={editECPhone}
                  onChange={e => setEditECPhone(e.target.value)}
                  placeholder="Phone (+15551234567)"
                  type="tel"
                  className="w-full bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)] placeholder:text-text-muted"
                />

                <input
                  value={editECEmail}
                  onChange={e => setEditECEmail(e.target.value)}
                  placeholder="Email address"
                  type="email"
                  className="w-full bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)] placeholder:text-text-muted"
                />

                <div className="flex gap-2">
                  <select
                    value={editECCarrier}
                    onChange={e => setEditECCarrier(e.target.value)}
                    className="flex-1 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)]"
                  >
                    {carrierOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.label} ({c.gateway})</option>
                    ))}
                  </select>
                  <select
                    value={editECRelationship}
                    onChange={e => setEditECRelationship(e.target.value)}
                    className="flex-1 bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)]"
                  >
                    {relationshipOptions.map(r => (
                      <option key={r.id} value={r.id}>{r.icon} {r.label}</option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editECIsPrimary}
                    onChange={e => setEditECIsPrimary(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`relative w-10 h-6 rounded-full shrink-0 transition-colors duration-200 ${editECIsPrimary ? "bg-rose-500" : "bg-[var(--color-surface-4)]"}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${editECIsPrimary ? "left-5" : "left-1"}`} />
                  </div>
                  <span className="text-text-primary text-sm">Primary contact (receives emergency alerts)</span>
                </label>

                <div className="flex gap-2">
                  <button onClick={() => saveEmergency(null)}
                    className="px-4 py-2 rounded-xl bg-[var(--color-accent-selected)] text-white text-xs font-semibold">Add Contact</button>
                  <button onClick={cancelEmergency}
                    className="px-4 py-2 rounded-xl bg-[var(--color-surface-2)] text-text-secondary text-xs">Cancel</button>
                </div>
              </div>
            )}

            {/* Add button */}
            {!addingEmergency && (
              <button
                onClick={startAddEmergency}
                className="w-full p-4 rounded-xl border-2 border-dashed border-[var(--color-surface-4)] text-text-muted text-sm hover:border-[var(--color-accent-selected)]/50 hover:text-text-secondary transition-all flex items-center justify-center gap-2"
              >
                <span className="text-lg">+</span>
                Add Emergency Contact
              </button>
            )}
          </div>
        </section>

        <div className="h-px bg-[var(--color-surface-3)]" />

        {/* ── Home Layout ─────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <h2 className="text-text-primary font-semibold text-2xl">Home Layout</h2>
            <p className="text-text-secondary mt-1">Show, hide, and reorder widgets on your home screen</p>
          </div>

          <div className="space-y-1">
            {widgets.map((id, idx) => {
              const def = ALL_WIDGETS.find((w) => w.id === id);
              if (!def) return null;
              const isFirst = idx === 0;
              const isLast = idx === widgets.length - 1;
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-[var(--color-surface-3)] bg-[var(--color-surface-1)]"
                >
                  {/* Drag handle / reorder buttons */}
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      onClick={() => moveUp(id)}
                      disabled={isFirst}
                      aria-label="Move up"
                      className={`w-6 h-5 rounded flex items-center justify-center transition-all text-xs ${
                        isFirst
                          ? "text-text-muted opacity-30 cursor-not-allowed"
                          : "text-text-secondary hover:text-text-primary hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveDown(id)}
                      disabled={isLast}
                      aria-label="Move down"
                      className={`w-6 h-5 rounded flex items-center justify-center transition-all text-xs ${
                        isLast
                          ? "text-text-muted opacity-30 cursor-not-allowed"
                          : "text-text-secondary hover:text-text-primary hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      ▼
                    </button>
                  </div>

                  {/* Widget info */}
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <span className="text-xl shrink-0">{def.emoji}</span>
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm font-medium">{def.label}</p>
                      <p className="text-text-muted text-xs truncate">{def.description}</p>
                    </div>
                  </div>

                  {/* Toggle switch */}
                  <label className="shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={widgets.includes(id)}
                      onChange={() => toggle(id)}
                      className="sr-only"
                    />
                    <div
                      className={`relative w-10 h-6 rounded-full transition-colors duration-200 ${
                        widgets.includes(id) ? "bg-[var(--color-accent-selected)]" : "bg-[var(--color-surface-4)]"
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                          widgets.includes(id) ? "left-5" : "left-1"
                        }`}
                      />
                    </div>
                  </label>
                </div>
              );
            })}
          </div>

          <p className="text-text-muted text-xs px-1">
            Changes apply immediately on your home screen. The header (greeting, date, family) is always visible.
          </p>
        </section>

        <div className="h-px bg-[var(--color-surface-3)]" />

        {/* ── Data Sync & Backup ─────────────────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <h2 className="text-text-primary font-semibold text-2xl">Data Sync & Backup</h2>
            <p className="text-text-secondary mt-1">Export your dashboard data or sync with the server</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Export All Data */}
            <button
              onClick={() => {
                const exportData: Record<string, any> = {};
                const keys = [
                  "consuela-events",
                  "consuela-tasks",
                  "consuela-schedules",
                  "consuela-meals",
                  "consuela-rewards",
                  "consuela-recipes",
                  "consuela-home-layout",
                  "consuela-emergency",
                  "home-ai-theme-config",
                  "consuela-weather-config",
                  "consuela-grocery",
                  "consuela-pantry",
                ];
                for (const key of keys) {
                  try {
                    const raw = localStorage.getItem(key);
                    if (raw) exportData[key] = JSON.parse(raw);
                  } catch {}
                }
                // Include family members from DB
                exportData["family-members"] = membersList;
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `consuela-backup-${new Date().toISOString().split("T")[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-[var(--color-surface-4)] bg-[var(--color-surface-1)] hover:border-[var(--color-accent-selected)]/50 hover:bg-[var(--color-accent-selected)]/5 transition-all active:scale-[0.98] cursor-pointer"
            >
              <span className="text-2xl">📥</span>
              <span className="text-text-primary text-sm font-semibold">Export All Data</span>
              <span className="text-text-muted text-xs text-center">Download a complete JSON backup of your dashboard data</span>
            </button>

            {/* Sync to Server */}
            <button
              onClick={async () => {
                const types: [string, string][] = [
                  ["events", "consuela-events"],
                  ["tasks", "consuela-tasks"],
                  ["schedules", "consuela-schedules"],
                  ["meals", "consuela-meals"],
                  ["rewards", "consuela-rewards"],
                  ["recipes", "consuela-recipes"],
                ];
                let synced = 0;
                for (const [type, key] of types) {
                  try {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const data = JSON.parse(raw);
                    await fetch("http://100.120.64.66:6789/data/sync", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ type, data }),
                    });
                    synced++;
                  } catch {}
                }
                alert(`Sync complete: ${synced}/${types.length} data types pushed to server.`);
              }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-[var(--color-surface-4)] bg-[var(--color-surface-1)] hover:border-[var(--color-accent-cyan)]/50 hover:bg-[var(--color-accent-cyan)]/5 transition-all active:scale-[0.98] cursor-pointer"
            >
              <span className="text-2xl">🔄</span>
              <span className="text-text-primary text-sm font-semibold">Sync to Server</span>
              <span className="text-text-muted text-xs text-center">Push all local data to the Hermes API server</span>
            </button>
          </div>

          {/* Auto-sync status */}
          <div className="p-4 rounded-xl border border-[var(--color-surface-3)] bg-[var(--color-surface-1)]">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[var(--color-accent-mint)] animate-pulse" />
              <div>
                <p className="text-text-primary text-sm font-medium">Auto-Sync Active</p>
                <p className="text-text-muted text-xs">
                  Data is synced on app load via <code className="text-[var(--color-accent-cyan)]">SyncInit</code>.
                  Use the buttons above for manual backup or full push.
                </p>
              </div>
            </div>
          </div>
        </section>

      </div>
    </PageShell>
  );
}
