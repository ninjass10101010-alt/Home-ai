"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/emergency-contacts')
      .then(r => r.json())
      .then(data => {
        if (data.contacts) setContacts(data.contacts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const primaryContacts = contacts.filter(c => c.isPrimary);
  const otherContacts = contacts.filter(c => !c.isPrimary);

  // Rose stays reserved for genuine alarm moments (top bar + 911 below).
  const alarmGlow = {
    boxShadow: "0 0 32px rgba(244,63,94,0.35), 0 0 64px rgba(244,63,94,0.18)",
    borderColor: "rgba(244,63,94,0.30)",
  };

  const renderContactCard = (contact: EmergencyContact) => (
    <Card key={contact.id} className="text-center">
      <div className="text-3xl mb-1">{contact.emoji || relationshipIcons[contact.relationship] || "👤"}</div>
      <p className="text-text-primary font-medium text-sm truncate">{contact.name}</p>
      <p className="text-text-secondary text-xs mt-0.5 truncate">{formatPhoneForDisplay(contact.phone)}</p>
      {contact.carrier && (
        <p className="text-text-secondary text-[10px] truncate">{carrierLabels[contact.carrier] || contact.carrier}</p>
      )}
      <a
        href={`tel:${cleanPhoneForTel(contact.phone)}`}
        aria-label={`Call ${contact.name}`}
        className="inline-flex min-h-[44px] items-center justify-center transition-all duration-150 bg-surface-3 text-text-primary hover:bg-surface-4 active:bg-surface-2 border border-surface-4 px-3 py-1.5 text-xs rounded-2xl gap-1.5 mt-2 w-full cursor-pointer font-medium no-underline"
      >
        Call
      </a>
    </Card>
  );

  return (
    <PageShell>
      <TopBar
        variant="emergency"
        title="Emergency"
        subtitle="Urgent Contacts & Help"
        back
      />

      <div className="px-4 space-y-6 mt-4 relative z-10 pb-6">
        {/* Contact list (loading skeleton while fetching) */}
        {loading ? (
          <section aria-busy="true" aria-label="Loading emergency contacts">
            <Skeleton className="mb-3 h-5 w-36" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-44 rounded-xl" />
              <Skeleton className="h-44 rounded-xl" />
            </div>
          </section>
        ) : (
          <>
            {/* Primary Contacts */}
            {primaryContacts.length > 0 && (
              <section>
                <h2 className="text-text-primary font-semibold text-base mb-3">Primary Contacts</h2>
                <div className="grid grid-cols-2 gap-3">
                  {primaryContacts.map(renderContactCard)}
                </div>
              </section>
            )}

            {/* Other Contacts */}
            {otherContacts.length > 0 && (
              <section>
                <h2 className="text-text-primary font-semibold text-base mb-3">Other Contacts</h2>
                <div className="grid grid-cols-2 gap-3">
                  {otherContacts.map(renderContactCard)}
                </div>
              </section>
            )}
          </>
        )}

        {/* Empty state */}
        {!loading && contacts.length === 0 && (
          <Card className="text-center py-8">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-text-primary font-medium">No emergency contacts yet</p>
            <p className="text-text-secondary text-sm mt-1">Add contacts in Settings to get started</p>
            <Link
              href="/settings"
              className="tap mt-4 inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--color-accent-selected)]/20 bg-[var(--color-accent-button)] px-4 text-sm font-medium text-white shadow-[0_12px_24px_rgba(0,0,0,0.16)]"
            >
              Go to Settings
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
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-medium truncate">{type.label}</p>
                  <p className="text-text-secondary text-xs truncate">{type.desc}</p>
                </div>
                <span className="text-xs text-text-secondary shrink-0">{type.contact}</span>
              </Card>
            ))}
          </div>
        </section>

        {/* Settings quick-link */}
        <Link href="/settings#emergency" className="block">
          <Card className="bg-[var(--color-surface-2)] border-dashed text-center cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors" interactive>
            <div className="flex items-center justify-center gap-2">
              <span className="text-lg">⚙️</span>
              <p className="text-text-secondary text-sm">Edit contacts in Settings</p>
            </div>
          </Card>
        </Link>

        {/* 911 */}
        <Card className="bg-rose-500/10" style={alarmGlow}>
          <div className="text-center">
            <span className="text-3xl">🚨</span>
            <h3 className="text-rose-400 font-semibold mt-2">Life-Threatening Emergency</h3>
            <p className="text-text-secondary text-xs mt-1">Call 911 immediately</p>
            <a
              href="tel:911"
              aria-label="Call 911"
              className="inline-flex min-h-[48px] items-center justify-center transition-all duration-150 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 border border-rose-500/20 px-6 py-3.5 text-base rounded-2xl gap-2.5 mt-3 w-full cursor-pointer font-semibold no-underline"
            >
              Call 911
            </a>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
