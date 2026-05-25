"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { db } from "@/db";

interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
  email: string;
  carrier?: string;
  relationship: string;
  isPrimary: boolean;
  emoji?: string;
}

const carrierLabels: Record<string, string> = {
  att: "AT&T",
  verizon: "Verizon",
  tmobile: "T-Mobile",
  sprint: "Sprint",
  virgin: "Virgin Mobile",
  cricket: "Cricket",
  metropcs: "MetroPCS",
  straighttalk: "Straight Talk",
  boost: "Boost Mobile",
};

const emergencyTypes = [
  { id: "minor", label: "Minor Injury", icon: "🤕", desc: "Small cuts, scrapes, or bruises", contact: "Mom or Dad" },
  { id: "lost", label: "Lost Item", icon: "🔍", desc: "Lost keys, phone, or important item", contact: "Call home" },
  { id: "lockout", label: "Locked Out", icon: "🔒", desc: "Locked out of house or car", contact: "Mom or Dad" },
  { id: "sick", label: "Not Feeling Well", icon: "🤒", desc: "Mild illness or discomfort", contact: "Mom or Dad" },
];

const relationshipIcons: Record<string, string> = {
  parent: "👨‍👩‍👧",
  guardian: "🛡️",
  grandparent: "👴",
  neighbor: "🏠",
  other: "👤",
};

function formatPhoneForDisplay(phone: string): string {
  // E.164 format: +1XXXXXXXXXX → (XXX) XXX-XXXX
  const cleaned = phone.replace(/[^0-9]/g, "");
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

function cleanPhoneForTel(phone: string): string {
  // Strip everything except + and digits for tel: protocol
  const cleaned = phone.replace(/[^+0-9]/g, "");
  // Ensure US numbers have +1 prefix
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  return cleaned;
}

export default function EmergencyPage() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Load from localStorage first (persisted by Settings), fallback to DB
    const stored = (() => {
      if (typeof window === "undefined") return null;
      try { const d = localStorage.getItem("consuela-emergency"); return d ? JSON.parse(d) : null; } catch { return null; }
    })();
    if (stored && stored.length > 0) {
      setContacts(stored);
    } else {
      setContacts(db.selectEmergencyContacts());
    }
  }, []);

  if (!mounted) {
    return (
      <PageShell>
        <div className="px-4 pt-12 pb-4 relative z-10" style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}>
          <Link href="/" className="text-nori-400 text-xs font-medium mb-4 inline-block">
            ← Back to Home
          </Link>
          <h1 className="text-2xl font-bold text-text-primary">Emergency Contacts</h1>
          <p className="text-text-secondary text-sm mt-1">Quick access for urgent situations</p>
        </div>
        <div className="px-4 space-y-6 relative z-10 animate-pulse">
          <div className="grid grid-cols-2 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-32 bg-[var(--color-surface-2)] rounded-xl" />)}
          </div>
        </div>
      </PageShell>
    );
  }

  const primaryContacts = contacts.filter(c => c.isPrimary);
  const otherContacts = contacts.filter(c => !c.isPrimary);

  return (
    <PageShell>
      <div
        className="px-4 pt-12 pb-4 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}
      >
        <Link href="/" className="text-nori-400 text-xs font-medium mb-4 inline-block">
          ← Back to Home
        </Link>
        <h1 className="text-2xl font-bold text-text-primary">Emergency Contacts</h1>
        <p className="text-text-secondary text-sm mt-1">Quick access for urgent situations</p>
      </div>

      <div className="px-4 space-y-6 relative z-10">
        {/* Primary Contacts */}
        {primaryContacts.length > 0 && (
          <section>
            <h2 className="text-text-primary font-semibold text-base mb-3">Primary Contacts</h2>
            <div className="grid grid-cols-2 gap-3">
              {primaryContacts.map((contact) => (
                <Card key={contact.id} className="text-center">
                  <div className="text-3xl mb-1">{contact.emoji || relationshipIcons[contact.relationship] || "👤"}</div>
                  <p className="text-text-primary font-medium text-sm">{contact.name}</p>
                  <p className="text-text-muted text-xs mt-0.5">{formatPhoneForDisplay(contact.phone)}</p>
                  {contact.carrier && (
                    <p className="text-text-muted text-[10px]">{carrierLabels[contact.carrier] || contact.carrier}</p>
                  )}
                  <a
                    href={`tel:${cleanPhoneForTel(contact.phone)}`}
                    className="inline-flex items-center justify-center transition-all duration-150 bg-surface-3 text-text-primary hover:bg-surface-4 active:bg-surface-2 border border-surface-4 px-3 py-1.5 text-xs rounded-xl gap-1.5 mt-2 w-full cursor-pointer font-medium no-underline"
                  >
                    Call
                  </a>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Other Contacts */}
        {otherContacts.length > 0 && (
          <section>
            <h2 className="text-text-primary font-semibold text-base mb-3">Other Contacts</h2>
            <div className="grid grid-cols-2 gap-3">
              {otherContacts.map((contact) => (
                <Card key={contact.id} className="text-center">
                  <div className="text-3xl mb-1">{contact.emoji || relationshipIcons[contact.relationship] || "👤"}</div>
                  <p className="text-text-primary font-medium text-sm">{contact.name}</p>
                  <p className="text-text-muted text-xs mt-0.5">{formatPhoneForDisplay(contact.phone)}</p>
                  {contact.carrier && (
                    <p className="text-text-muted text-[10px]">{carrierLabels[contact.carrier] || contact.carrier}</p>
                  )}
                  <a
                    href={`tel:${cleanPhoneForTel(contact.phone)}`}
                    className="inline-flex items-center justify-center transition-all duration-150 bg-surface-3 text-text-primary hover:bg-surface-4 active:bg-surface-2 border border-surface-4 px-3 py-1.5 text-xs rounded-xl gap-1.5 mt-2 w-full cursor-pointer font-medium no-underline"
                  >
                    Call
                  </a>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {contacts.length === 0 && (
          <Card className="text-center py-8">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-text-primary font-medium">No emergency contacts yet</p>
            <p className="text-text-secondary text-sm mt-1">Add contacts in Settings to get started</p>
            <Link href="/settings">
              <Button variant="primary" className="mt-4">
                Go to Settings
              </Button>
            </Link>
          </Card>
        )}

        {/* Common Situations */}
        <section>
          <h2 className="text-text-primary font-semibold text-base mb-3">Common Situations</h2>
          <div className="space-y-2">
            {emergencyTypes.map((type) => (
              <Card key={type.id} className="flex items-center gap-3">
                <span className="text-2xl">{type.icon}</span>
                <div className="flex-1">
                  <p className="text-text-primary text-sm font-medium">{type.label}</p>
                  <p className="text-text-muted text-xs">{type.desc}</p>
                </div>
                <span className="text-xs text-text-secondary">{type.contact}</span>
              </Card>
            ))}
          </div>
        </section>

        {/* Settings quick-link */}
        <Link href="/settings#emergency" className="block">
          <Card className="bg-[var(--color-surface-2)] border-dashed border-[var(--color-surface-4)] text-center cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors">
            <div className="flex items-center justify-center gap-2">
              <span className="text-lg">⚙️</span>
              <p className="text-text-secondary text-sm">Edit contacts in Settings</p>
            </div>
          </Card>
        </Link>

        {/* 911 */}
        <Card className="bg-rose-500/10 border-rose-500/20">
          <div className="text-center">
            <span className="text-3xl">🚨</span>
            <h3 className="text-rose-400 font-semibold mt-2">Life-Threatening Emergency</h3>
            <p className="text-text-muted text-xs mt-1">Call 911 immediately</p>
            <a
              href="tel:911"
              className="inline-flex items-center justify-center transition-all duration-150 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 border border-rose-500/20 px-6 py-3.5 text-base rounded-2xl gap-2.5 mt-3 w-full cursor-pointer font-semibold no-underline"
            >
              Call 911
            </a>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
