"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useWeatherConfig } from "@/hooks/useWeather";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

import { db } from "@/db";

const emojiOptions = ["👨","👩","👧","🧒","👶","👴","👵","🐶","🐱","🐩","🐕","🐈","🐠","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵"];

export default function SettingsPage() {
  const { theme, setMode, setAccentColor, setContrastBoost } = useTheme();
  const { weather, setLocation, setUnit, setTimeOfDay, setSeason } = useWeatherConfig();
  const [mounted, setMounted] = useState(false);

  // ─── Family Member editing state ────────────────────────────────────────
  const [membersList, setMembersList] = useState<any[]>([]);
  const [editingMemberIdx, setEditingMemberIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    setMounted(true);
    setMembersList(db.selectMembersDetailed());
  }, []);

  const startEditMember = (idx: number, member: any) => {
    setEditingMemberIdx(idx);
    setEditName(member.name);
    setEditEmoji(member.emoji);
  };

  const saveMember = (idx: number) => {
    const member = membersList[idx];
    if (!member || !editName.trim()) return;
    db.updateMember(member.name, { name: editName.trim(), emoji: editEmoji });
    setMembersList(prev => prev.map((m, i) => i === idx ? { ...m, name: editName.trim(), emoji: editEmoji } : m));
    setEditingMemberIdx(null);
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
    { id: "nori",   label: "Nori",   dark: "#3b82f6", light: "#2563eb" },
    { id: "violet", label: "Violet", dark: "#7c6ff7", light: "#7c3aed" },
    { id: "rose",   label: "Rose",   dark: "#f43f5e", light: "#e11d48" },
    { id: "cyan",   label: "Cyan",   dark: "#06b6d4", light: "#0891b2" },
    { id: "mint",   label: "Mint",   dark: "#4ade80", light: "#059669" },
    { id: "amber",  label: "Amber",  dark: "#f59e0b", light: "#d97706" },
  ] as const;

  if (!mounted) {
    return (
      <PageShell>
        <TopBar title="Settings" subtitle="Customize your Consuela experience" />
        <div className="px-4 py-6 space-y-8 animate-pulse">
          <div className="space-y-4">
            <div className="h-8 w-48 bg-[var(--color-surface-2)] rounded-lg" />
            <div className="h-4 w-64 bg-[var(--color-surface-2)] rounded-lg opacity-60" />
          </div>
          <div className="space-y-3">
            <div className="h-20 bg-[var(--color-surface-2)] rounded-xl" />
            <div className="h-20 bg-[var(--color-surface-2)] rounded-xl" />
            <div className="h-20 bg-[var(--color-surface-2)] rounded-xl" />
          </div>
        </div>
      </PageShell>
    );
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
                {/* Map pin icon */}
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
              {(["auto", "spring", "summer", "autumn", "winter"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSeason(s)}
                  className={`
                    py-3 rounded-xl border-2 text-sm font-semibold capitalize
                    transition-all duration-200 active:scale-95 ${s === "auto" ? "col-span-3" : ""}
                    ${weather.season === s
                      ? "border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10 text-[var(--color-accent-selected)]"
                      : "border-[var(--color-surface-3)] text-text-secondary hover:border-[var(--color-surface-5)] hover:text-text-primary"
                    }
                  `}
                >
                  {s}
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
                      <p className="text-text-primary font-semibold">System (Default)</p>
                      <p className="text-text-secondary text-xs">Follows your device settings</p>
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
              {/* Custom toggle */}
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
                      {/* Custom emoji input — type or paste any emoji/sticker */}
                      <input
                        value={editEmoji}
                        onChange={e => { const v = e.target.value; if (v !== "") setEditEmoji(v); }}
                        placeholder="Paste emoji or GIF URL..."
                        className="w-full bg-[var(--color-surface-2)] text-text-primary text-sm rounded-xl px-3 py-2 outline-none border border-[var(--color-surface-3)] focus:border-[var(--color-accent-selected)] placeholder:text-text-muted"
                      />
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
                      <div className="w-12 h-12 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center text-2xl shrink-0">
                        {member.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-sm font-semibold truncate">{member.name}</p>
                        <p className="text-text-muted text-xs">{member.role} · {member.age}y</p>
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

      </div>
    </PageShell>
  );
}