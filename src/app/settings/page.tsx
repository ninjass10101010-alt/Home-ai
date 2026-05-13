"use client";

import { useState } from "react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import SyncManager from "@/components/ui/SyncManager";

const familyMembers = [
  { name: "Sarah (Mom)", role: "Parent", emoji: "👩", color: "green", age: "38", joined: "Feb 2024" },
  { name: "Mike (Dad)", role: "Parent", emoji: "👨", color: "cyan", age: "40", joined: "Feb 2024" },
  { name: "Jake", role: "Child", emoji: "🧒", color: "violet", age: "12", joined: "Mar 2024" },
  { name: "Lily", role: "Child", emoji: "👧", color: "amber", age: "9", joined: "Mar 2024" },
];

interface ToggleProps {
  label: string;
  description?: string;
  defaultOn?: boolean;
}

function ToggleRow({ label, description, defaultOn = false }: ToggleProps) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between py-3 border-b border-surface-3 last:border-0">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-text-primary text-sm">{label}</p>
        {description && <p className="text-text-muted text-xs mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => setOn(!on)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
          on ? "bg-nori-500" : "bg-surface-4"
        }`}
      >
        <span
          className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
            on ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function SettingsRow({ icon, label, value, danger }: { icon: string; label: string; value?: string; danger?: boolean }) {
  return (
    <button className="w-full flex items-center gap-3 py-3 border-b border-surface-3 last:border-0 hover:opacity-80 transition-opacity text-left">
      <span className="text-xl shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${danger ? "text-rose-400" : "text-text-primary"}`}>{label}</p>
        {value && <p className="text-text-muted text-xs">{value}</p>}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-text-muted shrink-0">
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export default function SettingsPage() {
  return (
    <PageShell>
      <TopBar title="Family Profile" subtitle="heynori.com" back />

      <div className="px-4 space-y-5">
        {/* Family header */}
        <div
          className="rounded-2xl p-5 flex flex-col items-center text-center"
          style={{
            background: "linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(6,182,212,0.08) 100%)",
            border: "1px solid rgba(34,197,94,0.15)",
          }}
        >
        <div className="flex -space-x-2 mb-4">
          {familyMembers.map((m) => (
            <div key={m.name} className="ring-2 ring-surface-0 rounded-full">
              <Avatar name={m.name} color={m.color} emoji={m.emoji} size="lg" variant="emoji" />
            </div>
          ))}
        </div>
          <h2 className="text-text-primary font-bold text-xl">Johnson Family</h2>
          <p className="text-text-secondary text-sm mt-1">4 members · Plan: Consuela Pro 🌟</p>
          <div className="flex gap-2 mt-3">
            <Badge variant="green">Pro Plan</Badge>
            <Badge variant="cyan">Since Feb 2024</Badge>
          </div>
        </div>

        {/* Family members */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-text-primary font-semibold text-sm">Members</h3>
            <button className="text-nori-400 text-xs hover:text-nori-300">+ Invite</button>
          </div>
          <Card>
            <div className="space-y-3">
              {familyMembers.map((member) => (
            <div key={member.name} className="flex items-center gap-3">
              <Avatar name={member.name} color={member.color} emoji={member.emoji} size="md" variant="emoji" />
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-medium truncate">{member.name}</p>
                    <p className="text-text-muted text-xs">Age {member.age} · Joined {member.joined}</p>
                  </div>
                  <Badge variant={member.role === "Parent" ? "green" : "violet"}>{member.role}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* Sync & Integrations */}
        <section>
          <h3 className="text-text-primary font-semibold text-sm mb-3">Sync & Integrations</h3>
          <SyncManager />
        </section>

        {/* Notifications */}
        <section>
          <h3 className="text-text-primary font-semibold text-sm mb-3">Notifications</h3>
          <Card>
            <ToggleRow label="Event reminders" description="1 hour before events" defaultOn={true} />
            <ToggleRow label="Task nudges" description="When tasks are overdue" defaultOn={true} />
            <ToggleRow label="Meal plan reminders" description="Sunday evening" defaultOn={true} />
            <ToggleRow label="Grocery alerts" description="When pantry items run low" defaultOn={false} />
            <ToggleRow label="Weekly summary" description="Every Sunday morning" defaultOn={true} />
          </Card>
        </section>

        {/* AI Preferences */}
        <section>
          <h3 className="text-text-primary font-semibold text-sm mb-3">AI Preferences</h3>
          <Card>
            <ToggleRow label="Voice input" description="Use microphone for commands" defaultOn={true} />
            <ToggleRow label="Smart suggestions" description="Consuela proactively helps" defaultOn={true} />
            <ToggleRow label="Context memory" description="Remember past conversations" defaultOn={true} />
            <ToggleRow label="Meal suggestions" description="Based on dietary preferences" defaultOn={true} />
          </Card>
        </section>

        {/* Privacy */}
        <section>
          <h3 className="text-text-primary font-semibold text-sm mb-3">Privacy & Security</h3>
          <Card>
            <div className="space-y-1 divide-y divide-surface-3">
              <SettingsRow icon="🔒" label="Data & Privacy" value="End-to-end encrypted" />
              <SettingsRow icon="📤" label="Export family data" />
              <SettingsRow icon="🗑️" label="Delete family data" danger />
            </div>
          </Card>
          <p className="text-text-muted text-xs mt-2 text-center">
            All family data is encrypted at rest and in transit.{" "}
            <span className="text-nori-400">Privacy policy →</span>
          </p>
        </section>

        {/* Account */}
        <section className="pb-2">
          <h3 className="text-text-primary font-semibold text-sm mb-3">Account</h3>
          <Card>
            <div className="space-y-1 divide-y divide-surface-3">
              <SettingsRow icon="👤" label="Edit profile" value="Sarah Johnson" />
              <SettingsRow icon="🔑" label="Change password" />
              <SettingsRow icon="📱" label="Manage devices" value="3 active" />
              <SettingsRow icon="🚪" label="Sign out" danger />
            </div>
          </Card>
        </section>
      </div>
    </PageShell>
  );
}
