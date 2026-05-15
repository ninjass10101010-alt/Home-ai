"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Avatar from "@/components/ui/Avatar";
import SyncManager from "@/components/ui/SyncManager";
import Button from "@/components/ui/Button";
import pb from "@/lib/pocketbase";
import { compressImage } from "@/lib/image-utils";

type MemberRole = "mom" | "dad" | "son" | "daughter" | "other";

const ROLES: { value: MemberRole; label: string; emoji: string }[] = [
  { value: "mom", label: "Mom", emoji: "👩" },
  { value: "dad", label: "Dad", emoji: "👨" },
  { value: "son", label: "Son", emoji: "🧒" },
  { value: "daughter", label: "Daughter", emoji: "👧" },
  { value: "other", label: "Other", emoji: "👤" },
];

function ToggleRow({ label, description, defaultOn = false }: { label: string; description?: string; defaultOn?: boolean }) {
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
  const [members, setMembers] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Form State
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("other");
  const [emoji, setEmoji] = useState("👤");
  const [profileImage, setProfileImage] = useState<string | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    loadMembers();
  }, []);

  async function loadMembers() {
    try {
      const data = await pb.collection("members").getFullList();
      setMembers(data);
    } catch (e) {
      console.error("Failed to load members:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMember() {
    if (!name) return;
    setLoading(true);
    await pb.collection("members").create({ name, role, emoji, profileImage });
    resetForm();
    await loadMembers();
  }

  async function handleUpdateMember() {
    if (!editingMember || !name) return;
    setLoading(true);
    await pb.collection("members").update(editingMember.id, { name, role, emoji, profileImage });
    setEditingMember(null);
    resetForm();
    await loadMembers();
  }

  function resetForm() {
    setName("");
    setRole("other");
    setEmoji("👤");
    setProfileImage(undefined);
    setIsAdding(false);
  }

  async function handleDeleteMember(id: string) {
    if (!confirm("Remove this member?")) return;
    setLoading(true);
    await pb.collection("members").delete(id);
    await loadMembers();
  }

  function startEditing(member: any) {
    setEditingMember(member);
    setName(member.name);
    setRole(member.role);
    setEmoji(member.emoji || "👤");
    setProfileImage(member.profileImage);
  }

  // Handle Photo Selection
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setProfileImage(compressed);
      } catch (error) {
        console.error("Compression failed:", error);
      }
    }
  };

  // Simulate AI Emoji Generation
  async function generateAIEmoji() {
    setIsGenerating(true);
    
    // Mock the backend action since we removed the server actions
    await new Promise(r => setTimeout(r, 1500));
    const result = { success: true, emoji: "🤖" };
    
    if (result.success) {
      setEmoji(result.emoji || "👤");
      // In a real app, result.url would be set here as well
    } else {

      alert("Failed to generate AI emoji. Please try again.");
    }
    
    setIsGenerating(false);
  }

  return (
    <PageShell>
      <TopBar title="Settings" subtitle="Garcia Family" back />

      <div className="px-4 space-y-6 pb-20">
        {/* Family Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl p-6 flex flex-col items-center text-center relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(181, 131, 255, 0.12) 0%, rgba(255, 107, 138, 0.08) 100%)",
            border: "1px solid rgba(181, 131, 255, 0.2)",
          }}
        >
          {/* Animated Orbs */}
          <div className="absolute top-0 left-0 w-32 h-32 bg-accent-lavender/10 blur-3xl rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-32 h-32 bg-accent-coral/10 blur-3xl rounded-full translate-x-1/2 translate-y-1/2" />

          <div className="flex -space-x-3 mb-4 relative z-10">
            {members.slice(0, 5).map((m) => (
              <div key={m.id} className="ring-4 ring-surface-0 rounded-full">
                <Avatar 
                    name={m.name} 
                    color={
                      m.role === 'mom' ? 'green' : 
                      m.role === 'dad' ? 'cyan' : 
                      m.role === 'son' ? 'violet' : 
                      m.role === 'daughter' ? 'amber' : 'slate'
                    } 
                    emoji={m.emoji} 
                    src={m.profileImage}
                    size="lg" 
                    variant={m.profileImage ? "image" : "emoji"} 
                />
              </div>
            ))}
            {members.length > 5 && (
                <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-xs font-bold text-text-muted ring-4 ring-surface-0">
                    +{members.length - 5}
                </div>
            )}
          </div>
          <h2 className="text-text-primary font-bold text-2xl relative z-10">Garcia Family</h2>
          <p className="text-text-secondary text-sm mt-1 relative z-10">{members.length} members · Optimized by Consuela</p>
        </motion.div>

        {/* Members Management */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-text-primary font-semibold text-base">Family Members</h3>
            <Button 
                variant="primary" 
                size="sm" 
                onClick={() => {
                    setIsAdding(true);
                    resetForm();
                }}
            >
                + Add Member
            </Button>
          </div>

          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {members.map((member) => (
                <motion.div
                  key={member.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  <Card className="hover:border-nori-500/20 transition-all group">
                    <div className="flex items-center gap-4">
                      <Avatar 
                        name={member.name} 
                        emoji={member.emoji} 
                        src={member.profileImage}
                        size="lg" 
                        variant={member.profileImage ? "image" : "emoji"} 
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-base font-semibold truncate">{member.name}</p>
                        <p className="text-text-muted text-xs capitalize">{member.role}</p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                            onClick={() => startEditing(member)}
                            className="p-2 rounded-xl bg-surface-2 hover:bg-nori-500/10 text-text-secondary hover:text-nori-400 transition-all"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button 
                            onClick={() => handleDeleteMember(member.id)}
                            className="p-2 rounded-xl bg-surface-2 hover:bg-rose-500/10 text-text-secondary hover:text-rose-400 transition-all"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>

        {/* Sync & Integrations */}
        <section>
          <h3 className="text-text-primary font-semibold text-base mb-4">Sync & Integrations</h3>
          <SyncManager />
        </section>

        {/* Global Settings */}
        <section>
          <h3 className="text-text-primary font-semibold text-base mb-4">App Settings</h3>
          <Card>
            <div className="divide-y divide-surface-3">
                <ToggleRow label="Event reminders" description="1 hour before events" defaultOn={true} />
                <ToggleRow label="Voice input" description="Use microphone for commands" defaultOn={true} />
                <ToggleRow label="Smart suggestions" description="Consuela proactively helps" defaultOn={true} />
            </div>
          </Card>
        </section>

        <section className="pb-10">
          <Card>
             <SettingsRow icon="🚪" label="Sign out" danger />
          </Card>
        </section>
      </div>

      {/* Member Edit/Add Modal */}
      <AnimatePresence>
        {(isAdding || editingMember) && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsAdding(false); setEditingMember(null); }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ opacity: 0, y: 100, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 100, scale: 0.95 }}
              className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-[70] p-6 bg-surface-1 rounded-t-[32px] shadow-2xl border-t border-white/10"
            >
              <div className="w-12 h-1.5 bg-surface-4 rounded-full mx-auto mb-6" />
              <h3 className="text-xl font-bold text-text-primary mb-6">
                {isAdding ? "Add Family Member" : "Edit Member"}
              </h3>

              <div className="space-y-5">
                {/* Avatar Preview & Emoji Gen */}
                <div className="flex flex-col items-center gap-4 py-2">
                    <div className="relative group">
                        <label className="cursor-pointer">
                            <Avatar name={name || "New"} emoji={emoji} src={profileImage} size="lg" variant={profileImage ? "image" : "emoji"} />
                            <input 
                                type="file" 
                                className="hidden" 
                                accept="image/*"
                                onChange={handlePhotoUpload}
                            />
                            <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-5 h-5">
                                    <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" strokeLinecap="round" strokeLinejoin="round" />
                                    <circle cx={12} cy={13} r={3} strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </div>
                        </label>
                        <button 
                            onClick={generateAIEmoji}
                            disabled={isGenerating}
                            className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-nori-500 text-white flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all disabled:opacity-50"
                        >
                            {isGenerating ? (
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : "✨"}
                        </button>
                    </div>
                    <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold">Tap photo to upload · Tap ✨ to stylize</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter name..."
                    className="w-full px-4 py-3 rounded-2xl bg-surface-2 border border-surface-3 text-text-primary focus:outline-none focus:border-nori-500/50 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-wider">Role</label>
                  <div className="grid grid-cols-3 gap-2">
                    {ROLES.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => setRole(r.value)}
                        className={`py-2.5 rounded-xl border transition-all text-xs font-medium flex flex-col items-center gap-1 ${
                          role === r.value
                            ? "bg-nori-500/10 border-nori-500 text-nori-400"
                            : "bg-surface-2 border-surface-3 text-text-secondary"
                        }`}
                      >
                        <span className="text-lg">{r.emoji}</span>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() => { setIsAdding(false); setEditingMember(null); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1"
                    disabled={!name}
                    onClick={isAdding ? handleAddMember : handleUpdateMember}
                  >
                    {isAdding ? "Add Member" : "Save Changes"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </PageShell>
  );
}
