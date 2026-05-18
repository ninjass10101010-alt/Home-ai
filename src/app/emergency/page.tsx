"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import pb from "@/lib/pocketbase";

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  emoji: string;
  relationship: string;
}

interface EmergencySituation {
  id: string;
  label: string;
  icon: string;
  desc: string;
  contact: string;
}

const DEFAULT_SITUATIONS: EmergencySituation[] = [
  { id: "minor", label: "Minor Injury", icon: "🤕", desc: "Small cuts, scrapes, or bruises", contact: "Mom or Dad" },
  { id: "lost", label: "Lost Item", icon: "🔍", desc: "Lost keys, phone, or important item", contact: "Call home" },
  { id: "lockout", label: "Locked Out", icon: "🔒", desc: "Locked out of house or car", contact: "Mom or Dad" },
  { id: "sick", label: "Not Feeling Well", icon: "🤒", desc: "Mild illness or discomfort", contact: "Mom or Dad" },
];

export default function EmergencyPage() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [situations] = useState<EmergencySituation[]>(DEFAULT_SITUATIONS);
  const [isAdding, setIsAdding] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [emoji, setEmoji] = useState("👤");
  const [relationship, setRelationship] = useState("");

  useEffect(() => {
    loadContacts();

    // Real-time subscription — Consuela can push contact updates live
    pb.collection("emergency_contacts").subscribe("*", () => {
      loadContacts();
    });

    return () => {
      pb.collection("emergency_contacts").unsubscribe("*");
    };
  }, []);

  async function loadContacts() {
    try {
      const data = await pb.collection("emergency_contacts").getFullList({ sort: "name" });
      setContacts(data as unknown as EmergencyContact[]);
    } catch (e) {
      // Collection may not exist yet — start empty
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!name || !phone) return;
    setLoading(true);
    try {
      if (editingContact) {
        await pb.collection("emergency_contacts").update(editingContact.id, { name, phone, emoji, relationship });
      } else {
        await pb.collection("emergency_contacts").create({ name, phone, emoji, relationship });
      }
    } catch (e) {
      console.error("Failed to save emergency contact:", e);
    }
    resetForm();
    await loadContacts();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this emergency contact?")) return;
    setLoading(true);
    await pb.collection("emergency_contacts").delete(id);
    await loadContacts();
  }

  function startEditing(contact: EmergencyContact) {
    setEditingContact(contact);
    setName(contact.name);
    setPhone(contact.phone);
    setEmoji(contact.emoji || "👤");
    setRelationship(contact.relationship || "");
    setIsAdding(true);
  }

  function resetForm() {
    setName("");
    setPhone("");
    setEmoji("👤");
    setRelationship("");
    setIsAdding(false);
    setEditingContact(null);
  }

  return (
    <PageShell>
      <div
        className="px-4 pt-12 pb-4 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}
      >
        <Link href="/" className="text-nori-400 text-xs font-medium mb-4 inline-block">
          ← Back to Home
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Emergency Contacts</h1>
            <p className="text-text-secondary text-sm mt-1">Quick access for urgent situations</p>
          </div>
          <button
            onClick={() => { resetForm(); setIsAdding(true); }}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-nori-500/15 text-nori-400 hover:bg-nori-500/25 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-4 space-y-6 relative z-10 pb-24">
        {/* Primary Contacts */}
        <section>
          <h2 className="text-text-primary font-semibold text-base mb-3">Primary Contacts</h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-4 border-nori-500/30 border-t-nori-500 rounded-full animate-spin" />
            </div>
          ) : contacts.length === 0 ? (
            <Card className="text-center !py-8">
              <p className="text-3xl mb-2">📞</p>
              <p className="text-text-secondary text-sm">No emergency contacts yet.</p>
              <p className="text-text-muted text-xs mt-1">Ask Consuela to add them or tap + above.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {contacts.map((contact) => (
                <Card key={contact.id} className="text-center relative group">
                  <div className="text-3xl mb-1">{contact.emoji}</div>
                  <p className="text-text-primary font-medium text-sm">{contact.name}</p>
                  <p className="text-text-muted text-xs mt-0.5">{contact.phone}</p>
                  {contact.relationship && (
                    <p className="text-text-muted text-xs">{contact.relationship}</p>
                  )}
                  <a href={`tel:${contact.phone}`}>
                    <Button variant="secondary" size="sm" className="mt-2 w-full">
                      Call
                    </Button>
                  </a>
                  {/* Edit / Delete controls */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEditing(contact)}
                      className="w-6 h-6 rounded-lg bg-surface-2 hover:bg-nori-500/10 text-text-muted hover:text-nori-400 flex items-center justify-center transition-all"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(contact.id)}
                      className="w-6 h-6 rounded-lg bg-surface-2 hover:bg-rose-500/10 text-text-muted hover:text-rose-400 flex items-center justify-center transition-all"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Common Situations */}
        <section>
          <h2 className="text-text-primary font-semibold text-base mb-3">Common Situations</h2>
          <div className="space-y-2">
            {situations.map((type) => (
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

        {/* 911 */}
        <Card className="bg-rose-500/10 border-rose-500/20">
          <div className="text-center">
            <span className="text-3xl">🚨</span>
            <h3 className="text-rose-400 font-semibold mt-2">Life-Threatening Emergency</h3>
            <p className="text-text-muted text-xs mt-1">Call 911 immediately</p>
            <a href="tel:911">
              <Button variant="danger" className="mt-3 w-full">
                Call 911
              </Button>
            </a>
          </div>
        </Card>
      </div>

      {/* Add / Edit Modal */}
      {isAdding && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            onClick={resetForm}
          />
          <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-[70] p-6 bg-surface-1 rounded-t-[32px] shadow-2xl border-t border-white/10">
            <div className="w-12 h-1.5 bg-surface-4 rounded-full mx-auto mb-6" />
            <h3 className="text-xl font-bold text-text-primary mb-6">
              {editingContact ? "Edit Contact" : "Add Emergency Contact"}
            </h3>
            <div className="space-y-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value)}
                  placeholder="😊"
                  className="w-16 px-3 py-3 rounded-2xl bg-surface-2 border border-surface-3 text-text-primary text-center text-xl focus:outline-none focus:border-nori-500/50"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name..."
                  className="flex-1 px-4 py-3 rounded-2xl bg-surface-2 border border-surface-3 text-text-primary focus:outline-none focus:border-nori-500/50"
                />
              </div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone number..."
                className="w-full px-4 py-3 rounded-2xl bg-surface-2 border border-surface-3 text-text-primary focus:outline-none focus:border-nori-500/50"
              />
              <input
                type="text"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="Relationship (Mom, Dad, etc.)..."
                className="w-full px-4 py-3 rounded-2xl bg-surface-2 border border-surface-3 text-text-primary focus:outline-none focus:border-nori-500/50"
              />
              <div className="flex gap-3 pt-2">
                <Button variant="ghost" className="flex-1" onClick={resetForm}>
                  Cancel
                </Button>
                <Button variant="primary" className="flex-1" disabled={!name || !phone} onClick={handleSave}>
                  {editingContact ? "Save Changes" : "Add Contact"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}