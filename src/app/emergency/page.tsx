"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight, Settings } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Surface from "@/components/ui/Surface";
import Skeleton from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/db";

/**
 * Rose TEXT is mixed toward the theme's own body ink instead of used raw.
 * `--color-accent-rose` is #e11d48 in light, and at 16px semibold on this
 * page's near-white surfaces that measures 4.35:1 — under the 4.5:1 body floor,
 * on the page title, the 911 heading and the 911 link. The 55/45 mix inverts per
 * theme because `--color-text-primary` inverts with it: light gets a deeper rose
 * (7.4:1), dark gets a lifted one (7.7:1). Written inline rather than as a token
 * because `--color-accent-ink-rose` is only declared in the dark block.
 */
const ROSE_INK = "color-mix(in srgb, var(--color-accent-rose) 55%, var(--color-text-primary))";

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
  const { currentUser, hydrated } = useAuth();
  const isParent = hydrated && currentUser?.role === "parent";
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    fetch('/api/emergency-contacts')
      .then((r) => {
        if (!r.ok) {
          // Guests (and expired sessions) are gated by the session middleware —
          // fall back to the local contact cache instead of crashing.
          setContacts(db.selectEmergencyContacts() as EmergencyContact[]);
          setUsingFallback(true);
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.contacts) {
          setContacts(data.contacts);
          setUsingFallback(data.contactsSource === "cache");
        }
      })
      .catch(() => {
        setContacts(db.selectEmergencyContacts() as EmergencyContact[]);
        setUsingFallback(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const primaryContacts = contacts.filter(c => c.isPrimary);
  const otherContacts = contacts.filter(c => !c.isPrimary);
  const safetyActionLabel = isParent
    ? contacts.length > 0 ? "Manage contacts" : "Add contacts"
    : "Open safety settings";
  const emptyContactsDescription = isParent
    ? "Add or manage emergency contacts to get started."
    : "Ask a parent to add or manage emergency contacts.";
  const safetyQuickLinkLabel = isParent
    ? contacts.length > 0 ? "Manage contacts in Safety" : "Add or manage contacts in Safety"
    : "Open safety settings";

  // Rose stays reserved for genuine alarm moments (top bar + 911 below).
  const alarmGlow = {
    boxShadow: "0 0 32px rgba(244,63,94,0.35), 0 0 64px rgba(244,63,94,0.18)",
    borderColor: "rgba(244,63,94,0.30)",
  };

  const renderContactCard = (contact: EmergencyContact) => (
    <Surface key={contact.id} className="text-center">
      <div className="text-3xl mb-1">{contact.emoji || relationshipIcons[contact.relationship] || "👤"}</div>
      <p className="text-text-primary font-medium text-sm truncate">{contact.name}</p>
      <p className="text-text-secondary text-xs mt-0.5 truncate">{formatPhoneForDisplay(contact.phone)}</p>
      {contact.carrier && (
        <p className="text-text-secondary text-xs truncate">{carrierLabels[contact.carrier] || contact.carrier}</p>
      )}
      <a
        href={`tel:${cleanPhoneForTel(contact.phone)}`}
        aria-label={`Call ${contact.name}`}
        className="inline-flex min-h-[44px] items-center justify-center transition-all duration-150 bg-surface-3 text-text-primary hover:bg-surface-4 active:bg-surface-2 border border-surface-4 px-3 py-1.5 text-xs rounded-2xl gap-1.5 mt-2 w-full cursor-pointer font-medium no-underline"
      >
        Call
      </a>
    </Surface>
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
            {/* One honest sentence per state: offline-with-contacts says so;
                genuinely-empty falls through to the empty state below. */}
            {usingFallback && (
              <p className="text-xs text-text-secondary text-center -mb-2">
                Live emergency contacts are unavailable — showing this device&apos;s saved list.
              </p>
            )}

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
          <Surface className="text-center py-8">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-text-primary font-medium">No emergency contacts yet</p>
            <p className="text-text-secondary text-sm mt-1">{emptyContactsDescription}</p>
            <Link
              href="/settings/safety"
              className="tap mt-4 inline-flex h-11 items-center justify-center rounded-2xl border border-[var(--color-accent-selected)]/20 bg-[var(--color-accent-button)] px-4 text-sm font-medium text-white shadow-[0_12px_24px_rgba(0,0,0,0.16)]"
            >
              {safetyActionLabel}
            </Link>
          </Surface>
        )}

        {/* Common Situations */}
        <section>
          <h2 className="text-text-primary font-semibold text-base mb-3">Common Situations</h2>
          {/* Two columns once there is room. Stretched to the shell's full
              1300px measure on a wall, each row was a 1300×64 sliver with its
              label inside the first 250px and its "Mom or Dad" inside the last
              100px — 950px of nothing between two words. Pairing them halves the
              measure, fills the width, and gives the page a second row rhythm
              under the contacts card. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {emergencyTypes.map((type) => (
              <Surface key={type.id} className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">{type.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-medium truncate">{type.label}</p>
                  <p className="text-text-secondary text-xs truncate">{type.desc}</p>
                </div>
                <span className="text-xs text-text-secondary shrink-0">{type.contact}</span>
              </Surface>
            ))}
          </div>
        </section>

        {/* Settings quick-link — left-aligned with a chevron. It was a
            1300px dashed bar with a centred ⚙️ emoji, which reads as a disabled
            field rather than a destination; a lucide mark plus a trailing
            chevron states the row is a link, and it stops the page carrying two
            different icon languages in one header. */}
        <Link href="/settings/safety" className="block tap">
          <Surface className="bg-[var(--color-surface-2)] border-dashed cursor-pointer hover:bg-[var(--color-surface-3)] transition-colors" interactive>
            <div className="flex items-center gap-3">
              <Settings className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
              <p className="flex-1 text-text-secondary text-sm">{safetyQuickLinkLabel}</p>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
            </div>
          </Surface>
        </Link>

        {/* 911 */}
        <Surface className="bg-[var(--color-accent-rose)]/10" style={alarmGlow}>
          <div className="text-center">
            <span className="text-3xl" aria-hidden="true">🚨</span>
            <h3 className="font-semibold mt-2" style={{ color: ROSE_INK }}>Life-Threatening Emergency</h3>
            <p className="text-text-secondary text-xs mt-1">Call 911 immediately</p>
            <a
              href="tel:911"
              aria-label="Call 911"
              className="inline-flex min-h-[48px] items-center justify-center transition-all duration-150 bg-[var(--color-accent-rose)]/15 hover:bg-[var(--color-accent-rose)]/25 border border-[var(--color-accent-rose)]/20 px-6 py-3.5 text-base rounded-2xl gap-2.5 mt-3 w-full cursor-pointer font-semibold no-underline"
              style={{ color: ROSE_INK }}
            >
              Call 911
            </a>
          </div>
        </Surface>
      </div>
    </PageShell>
  );
}
