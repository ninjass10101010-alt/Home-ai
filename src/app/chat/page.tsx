/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useRef, useEffect, useMemo, Suspense, useSyncExternalStore } from "react";
import CapsuleNav from "@/components/ui/CapsuleNav";
import Avatar from "@/components/ui/Avatar";
import { EmojiText } from "@/components/ui/EmojiText";
import SyncStatusBanner from "@/components/ui/SyncStatusBanner";
import Modal from "@/components/ui/Modal";
import { UnifiedInput } from "@/components/chat/UnifiedInput";
import AdjustPointsChip from "@/components/chat/AdjustPointsChip";
import { FamilyBrief } from "./FamilyBrief";
import { OpenLoopChips } from "./OpenLoopChips";
import { messageOrigin, stripForSpeech } from "@/lib/consuela/chat-context";
import { speak, stopSpeaking, isSpeaking, isSpeechSupported } from "@/lib/consuela/speech";
import { sortThread, visibleThread, SEED_GREETING_ID } from "@/lib/chat-thread";
import {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  ensureHydrated,
  send as sendChat,
  stop as stopChat,
  startNewConversation,
  retry as retryChat,
} from "@/lib/chat-store";

import { db } from "@/db";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePendingChatQuery } from "@/hooks/usePendingChatQuery";

const SPEAKER_STORAGE_KEY = "consuela-chat-speaker";

// Photo data-URL speakers render as a real <img> (SigmaImage) via the shared
// EmojiText; plain emoji stay text. Never render the raw string — member
// photos are 100KB+ base64 data URLs (the "letterings" bug class).
function EmojiSpan({ emoji, alt = "" }: { emoji: string; alt?: string }) {
  return <EmojiText emoji={emoji} alt={alt} />;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderContent(text: string) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul key={`ul-${key}`} className="my-1 ml-4 list-disc space-y-0.5">
        {listBuffer.map((item, j) => (
          <li key={j} dangerouslySetInnerHTML={{ __html: item }} />
        ))}
      </ul>
    );
    listBuffer = [];
  };
  lines.forEach((line, i) => {
    const escaped = escapeHtml(line);
    // Markdown list lines ("- item" / "* item") render as real list items.
    const listItem = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (listItem) {
      listBuffer.push(
        escapeHtml(listItem[1]).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      );
      if (i === lines.length - 1) flushList(`end-${i}`);
      return;
    }
    flushList(`mid-${i}`);
    const bold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    nodes.push(
      <span key={i}>
        <span dangerouslySetInnerHTML={{ __html: bold }} />
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
  return nodes;
}

function ChatContent() {
  // Live roster: bump a version on consuela-members-updated so the speaker
  // picker re-reads the roster when the members cache refreshes (60s
  // CacheRefresher pull, patchMemberLocal after a profile save).
  const [membersVersion, setMembersVersion] = useState(0);
  useEffect(() => {
    const onMembersUpdated = () => setMembersVersion(v => v + 1);
    window.addEventListener("consuela-members-updated", onMembersUpdated);
    return () => window.removeEventListener("consuela-members-updated", onMembersUpdated);
  }, []);
  // membersVersion bumps when the async members cache refreshes (see the
  // consuela-members-updated listener above) so the roster memo recomputes —
  // deliberate recompute trigger, same pattern as PlanTab's familyMembers.
  const membersData = useMemo(() => db.selectMembers(), [membersVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberOptions = useMemo(() =>
    membersData.filter((m: any) => m.role !== "pet").map((m: any) => ({
      name: m.name,
      emoji: m.emoji,
      color: m.color,
    })), [membersData]);

  // Hardcoded default — same on server & client, avoids hydration mismatch
  // when member emojis differ between SSR (seed text) and client (data: URLs from localStorage).
  const [currentSpeaker, setCurrentSpeaker] = useState<{ name: string; emoji: string; color: string }>({
    name: "Family", emoji: "👨‍👩‍👧‍👦", color: "violet",
  });

  // Hydrate speaker from localStorage + member data after mount (client only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SPEAKER_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const member = memberOptions.find((m: any) => m.name === parsed.name);
        if (member) {
          // Always use the live member emoji (never a stale data: URL)
          return setCurrentSpeaker({ ...parsed, emoji: member.emoji });
        }
      }
    } catch {}
    // Fallback to first member if no saved speaker
    if (memberOptions.length > 0) {
      setCurrentSpeaker(memberOptions[0]);
    }
  }, [memberOptions]);

  const saveSpeaker = (speaker: typeof currentSpeaker) => {
    setCurrentSpeaker(speaker);
    if (typeof window !== "undefined") {
      const member = memberOptions.find((m: any) => m.name === speaker.name);
      const storeEmoji = (member?.emoji && member.emoji.startsWith('data:')) ? '' : member?.emoji || speaker.emoji;
      localStorage.setItem(SPEAKER_STORAGE_KEY, JSON.stringify({ ...speaker, emoji: storeEmoji }));
    }
  };

  const { currentUser, isLoggedIn } = useAuth();
  const activeSpeaker = isLoggedIn && currentUser
    ? { name: currentUser.name, emoji: currentUser.emoji, color: currentUser.color }
    : currentSpeaker;

  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { messages, isTyping, statusLine, hydrated, streaming } = store;

  // Hydrate once per page load (localStorage + today's PocketBase thread).
  // A remount re-attaches to the store; the store itself does a cheap
  // incremental reconcile instead of a second full read.
  useEffect(() => {
    void ensureHydrated();
  }, []);
  const [showSpeakerPicker, setShowSpeakerPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const speakerPickerRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const reducedMotionRef = useRef(false);
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q");

  // Hero state: the hero owns a truly EMPTY conversation only. Any real
  // message hands the view to the thread — including while Consuela is
  // thinking (the typing bubble renders under the last message), because
  // hiding the history during a reply was the reported bug.
  // Deterministic, conversation-scoped view: sorted by time and sliced at the
  // newest reset marker, so order never depends on merge timing and a new
  // conversation hides everything before its divider.
  const visibleMessages = useMemo(() => visibleThread(sortThread(messages)), [messages]);
  const userMessageCount = visibleMessages.filter(m => m.role === "user").length;
  // Any real message (a user row, or an assistant reply that is not the seed
  // greeting) hands the view to the thread — otherwise a marker followed only
  // by a reply would hide it.
  const hasRealMessages = visibleMessages.some(
    m => m.role === "user" || (m.role === "assistant" && m.id !== SEED_GREETING_ID),
  );
  const showHero = !hasRealMessages;

  // Hide quick actions while Consuela is thinking — don't let them tap again
  const showQuickActions = userMessageCount === 0 && !isTyping;

  // ─── Read-aloud orb (pre-readers): the strip's mini orb speaks the last reply ───
  const lastAssistantReply = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.role === "assistant" && m.content.trim() && !m.errorFor) return m.content;
    }
    return null;
  }, [visibleMessages]);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!speaking) return;
    // Sync with natural utterance ends (cheap poll while active).
    const t = window.setInterval(() => {
      if (!isSpeaking()) setSpeaking(false);
    }, 500);
    return () => window.clearInterval(t);
  }, [speaking]);
  const toggleReadAloud = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (!lastAssistantReply) return;
    speak(stripForSpeech(lastAssistantReply));
    setSpeaking(isSpeechSupported());
  };
  useEffect(() => {
    if (speaking && !isSpeechSupported()) setSpeaking(false);
  }, [speaking]);

  // Only auto-scroll while the reader is already near the bottom — never
  // fight someone scrolling back through history.
  useEffect(() => {
    if (!pinnedToBottom) return;
    bottomRef.current?.scrollIntoView({
      behavior: reducedMotionRef.current ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, isTyping, pinnedToBottom]);

  const handleMessagesScroll = () => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinnedToBottom(distanceFromBottom < 80);
  };

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Close the speaker picker on outside tap or Escape.
  useEffect(() => {
    if (!showSpeakerPicker) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!speakerPickerRef.current?.contains(e.target as Node)) setShowSpeakerPicker(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSpeakerPicker(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showSpeakerPicker]);

  const stopGenerating = stopChat;

  const retryMessage = (failedText: string, failedId: number) => {
    retryChat(failedText, failedId, activeSpeaker);
  };

  const sendMessage = (text: string) => {
    // Sending always re-pins the thread to the newest message.
    setPinnedToBottom(true);
    return sendChat(text, activeSpeaker);
  };

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // Quick-action chips fill the composer as an EDITABLE draft (remount via
  // key) instead of firing a real write on one tap — a stray tap on the
  // kitchen phone must never create family data by itself.
  const [draft, setDraft] = useState<{ text: string; seq: number } | null>(null);
  const draftSeq = useRef(0);
  const fillDraft = (text: string) => {
    draftSeq.current += 1;
    setDraft({ text, seq: draftSeq.current });
  };
  const clearChat = async () => {
    setConfirmClearOpen(false);
    await startNewConversation();
  };

  // Deep-link query: /chat?q=... fires the query exactly once, after the
  // thread has hydrated, and strips the param from the URL immediately.
  usePendingChatQuery(queryParam, hydrated, sendMessage);

  // Speaker-picker handoff for the FamilyBrief's speaker card (guests only —
  // signed-in members speak as themselves).
  const openSpeakerPicker = () => setShowSpeakerPicker(true);

  return (
    <div className="page-settle min-h-screen max-w-lg mx-auto flex flex-col relative bg-surface-0">

      {/* ─── Top bar ─── */}
      <div
        className="sticky top-0 z-40 mx-3 sm:mx-4 mt-3 px-3 sm:px-4 py-3 glass-strong rounded-3xl flex items-center gap-4"
        style={{ marginTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      >
        <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-lg shrink-0"
          style={{ background: "linear-gradient(135deg, var(--color-accent-selected), color-mix(in srgb, var(--color-accent-selected) 55%, white))", boxShadow: "0 0 16px color-mix(in srgb, var(--color-accent-selected) 30%, transparent)" }}
        >
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-text-primary truncate">Consuela</h1>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-mint)] animate-pulse shrink-0" />
            <span className="text-[11px] text-text-secondary truncate">AI Family Assistant</span>
          </div>
        </div>

        {isLoggedIn ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-2xl glass-subtle text-text-secondary text-xs shrink-0">
            <EmojiSpan emoji={activeSpeaker.emoji} alt={activeSpeaker.name} />
            <span className="max-w-[64px] truncate">{activeSpeaker.name.split(" ")[0]}</span>
          </div>
        ) : (
          <div className="relative shrink-0" ref={speakerPickerRef}>
            <button
              onClick={() => setShowSpeakerPicker(!showSpeakerPicker)}
              aria-label={`Speaking as ${activeSpeaker.name}`}
              aria-haspopup="menu"
              aria-expanded={showSpeakerPicker}
              // 26px visual pill; ::after -inset-y-3 grows the HIT AREA to
              // 50px tall (26+24 ≥ 44). -inset-x-2 caps horizontal expansion
              // at 8px/side so the bar's gap-4 (16px) clears this pill's 8px
              // + the Clear button's 6px (14px) — adjacent hit areas never
              // overlap. before:-inset is dead here — the glass-subtle
              // material ::before wins the pseudo-element.
              className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-2xl glass-subtle text-text-secondary hover:text-text-primary transition-colors text-xs after:absolute after:-inset-y-3 after:-inset-x-2 after:content-['']"
            >
              <EmojiSpan emoji={activeSpeaker.emoji} alt={activeSpeaker.name} />
              <span className="max-w-[64px] truncate">{activeSpeaker.name.split(" ")[0]}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {showSpeakerPicker && (
              <div
                className="absolute right-0 top-full mt-1 glass-strong rounded-2xl shadow-xl z-50 py-1 min-w-[160px]"
                role="menu"
                aria-label="Choose speaker"
                onClick={() => setShowSpeakerPicker(false)}
              >
                {memberOptions.map(m => (
                  <button
                    key={m.name}
                    role="menuitem"
                    onClick={() => saveSpeaker(m)}
                    className={`relative w-full flex items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-white/5 focus-visible:bg-white/5 ${
                      currentSpeaker.name === m.name ? "text-[var(--color-accent-selected)] bg-[color-mix(in_srgb,var(--color-accent-selected)_10%,transparent)]" : "text-text-primary"
                    }`}
                  >
                    <EmojiSpan emoji={m.emoji} alt={m.name} />
                    <span>{m.name}</span>
                    {currentSpeaker.name === m.name && <span className="ml-auto text-[var(--color-accent-selected)]">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setConfirmClearOpen(true)}
          aria-label="Start a new conversation"
          title="New conversation (/new)"
          className="relative w-8 h-8 flex items-center justify-center rounded-2xl glass-subtle text-text-secondary hover:text-text-primary transition-colors shrink-0 after:absolute after:-inset-1.5 after:content-['']"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M21 12a9 9 0 1 1-9-9" />
            <path d="M21 3v6h-6" />
            <path d="M12 8v8M8 12h8" className="hidden" aria-hidden />
          </svg>
        </button>
      </div>

      {/* ─── Signed-out honesty: chat without a session is this-device-only ─── */}
      <SyncStatusBanner
        message="🔐 Signed out — this conversation stays on this device. Sign in with your PIN to join the family thread."
        className="mx-3 sm:mx-4 mt-3"
      />

      {/* ─── Messages area ─── */}
      <div
        ref={scrollAreaRef}
        onScroll={handleMessagesScroll}
        role="log"
        aria-label="Conversation with Consuela"
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {/* Active-thread glance: who's speaking + today in one line + read-aloud orb */}
        {!showHero && (
          <div className="flex items-center gap-2 mx-3 sm:mx-4 mt-2">
            <div className="flex-1 min-w-0">
              <FamilyBrief
                compact
                speaker={activeSpeaker}
                onDraft={fillDraft}
                onSpeakerTap={openSpeakerPicker}
                signedIn={isLoggedIn}
              />
            </div>
            {lastAssistantReply && isSpeechSupported() && (
              <button
                onClick={toggleReadAloud}
                aria-label={speaking ? "Stop reading" : "Read the last reply aloud"}
                title={speaking ? "Stop reading" : "Read the last reply aloud"}
                className={`tap-sm shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-lg ${
                  speaking
                    ? "bg-[var(--color-accent-selected)]/25 ring-2 ring-[var(--color-accent-selected)]/50"
                    : "glass-subtle"
                }`}
              >
                <span aria-hidden>{speaking ? "⏹" : "🔊"}</span>
              </button>
            )}
          </div>
        )}
        {/* Hero: the family's day + a companion orb — the brief IS the opening */}
        {showHero && (
          <div className="flex flex-col items-center pt-6 pb-6 gap-5">
            <div className="flex items-center gap-4 w-full px-1 chat-hero-enter">
              <div
                className="w-[72px] h-[72px] rounded-full shrink-0 chat-hero-orb"
                style={{
                  background: "radial-gradient(circle at 40% 35%, color-mix(in srgb, var(--color-accent-selected) 85%, white) 0%, color-mix(in srgb, var(--color-accent-selected) 60%, transparent) 35%, color-mix(in srgb, var(--color-accent-selected) 20%, transparent) 70%, transparent 100%)",
                  boxShadow: "0 0 40px color-mix(in srgb, var(--color-accent-selected) 25%, transparent), inset 0 2px 0 rgba(255,255,255,0.2)",
                }}
                aria-hidden
              />
              <div className="min-w-0">
                <h2 className="text-2xl font-bold leading-tight"
                  style={{
                    background: "linear-gradient(135deg, var(--color-accent-selected), color-mix(in srgb, var(--color-accent-selected) 60%, white))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  Hi, I&apos;m Consuela
                </h2>
                <p className="text-sm text-text-secondary mt-0.5">
                  Here&apos;s today — ask me anything.
                </p>
              </div>
            </div>

            {/* The family's day — dinner, next up, who's speaking */}
            {!isTyping && (
              <div className="w-full chat-hero-enter chat-hero-enter-delay-200">
                <FamilyBrief
                  speaker={activeSpeaker}
                  onDraft={fillDraft}
                  onSpeakerTap={openSpeakerPicker}
                  signedIn={isLoggedIn}
                />
              </div>
            )}

            {/* Consuela's live open loops (static drafts when the engine is quiet) */}
            {showQuickActions && (
              <div className="w-full chat-hero-enter chat-hero-enter-delay-300">
                <OpenLoopChips onDraft={fillDraft} role={currentUser?.role} />
              </div>
            )}
          </div>
        )}

        {/* Conversation messages */}
        {!showHero && visibleMessages.map((msg) => {
          if (msg.role === "system") {
            return (
              <div key={msg.id} className="flex items-center gap-3 py-1" role="separator" aria-label="New conversation">
                <span className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] uppercase tracking-wider text-text-secondary whitespace-nowrap">✨ New conversation</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
            );
          }
          return (
          <div
            key={msg.id}
            className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-2xl flex items-center justify-center text-sm shrink-0 mt-0.5"
                style={{
                  background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 30%, transparent), color-mix(in srgb, var(--color-accent-selected) 15%, transparent))",
                  boxShadow: "0 0 12px color-mix(in srgb, var(--color-accent-selected) 15%, transparent)",
                }}
              >
                ✨
              </div>
            )}
            {msg.role === "user" && (
              <Avatar name={msg.speaker || activeSpeaker.name}
                color={activeSpeaker.color || "green"}
                emoji={msg.speakerEmoji || activeSpeaker.emoji}
                size="sm" variant="emoji" />
            )}
            <div className={`max-w-[82%] min-w-0 space-y-2 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
              {msg.role === "user" && (messageOrigin(msg) ? (
                <span className="text-[11px] text-text-secondary px-1">{messageOrigin(msg)}</span>
              ) : msg.speaker ? (
                <span className="text-[11px] text-text-secondary px-1">{msg.speaker.split(" ")[0]}</span>
              ) : null)}
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed break-words [overflow-wrap:anywhere] ${
                  msg.role === "user"
                    ? "text-white rounded-tr-md"
                    : "rounded-tl-md text-text-primary"
                }`}
                style={
                  msg.role === "user"
                    ? { background: "linear-gradient(135deg, var(--color-accent-button), color-mix(in srgb, var(--color-accent-button) 72%, white))" }
                    : {
                        background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 18%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 8%, transparent) 100%)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.12)",
                      }
                }
              >
                {renderContent(msg.content)}
              </div>

              {msg.role === "assistant" && msg.errorFor && (
                <button
                  onClick={() => msg.errorFor && retryMessage(msg.errorFor, msg.id)}
                  className="tap-sm relative inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full glass-subtle px-4 py-2.5 text-xs font-semibold text-[var(--color-accent-selected)]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Try again
                </button>
              )}

              {/* Task 15 — point adjustments move ONLY behind a parent's PIN. */}
              {msg.role === "assistant" && msg.proposals && msg.proposals.length > 0 && (
                <div className="flex flex-wrap gap-2 self-start" data-testid="point-proposals">
                  {msg.proposals.map((p, i) => (
                    <AdjustPointsChip
                      key={`${p.args.member}|${p.args.delta}|${p.args.reason}|${i}`}
                      proposal={p}
                      actorName={currentUser?.name ?? null}
                    />
                  ))}
                </div>
              )}

              <span className="text-[11px] text-text-secondary px-1">{msg.timestamp}</span>
            </div>
          </div>
          );
        })}

        {isTyping && (
          <div role="status" aria-live="polite" className="flex gap-2.5">
            <div className="w-8 h-8 rounded-2xl flex items-center justify-center text-sm shrink-0"
              style={{
                background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 30%, transparent), color-mix(in srgb, var(--color-accent-selected) 15%, transparent))",
                boxShadow: "0 0 12px color-mix(in srgb, var(--color-accent-selected) 15%, transparent)",
              }}
            >
              ✨
            </div>
            <div
              className="rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1"
              style={{
                background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent-selected) 12%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 6%, transparent) 100%)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {statusLine ? (
                <span className="text-xs text-text-secondary whitespace-nowrap min-w-0 max-w-[60vw] sm:max-w-xs truncate">{statusLine}</span>
              ) : (
                <span className="sr-only">Consuela is thinking…</span>
              )}
              {[0, 1, 2].map((i) => (
                <div key={i} className="chat-dot chat-dot-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ─── Input area ─── */}
      <div
        className="sticky bottom-0 z-50"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom) + 5.5rem)",
        }}
      >
        <UnifiedInput
          key={draft?.seq ?? "fresh"}
          initialValue={draft?.text}
          onSendMessage={sendMessage}
          disabled={false}
          sendDisabled={streaming}
          streaming={streaming}
          onStop={stopGenerating}
          showTip={userMessageCount === 0}
        />
      </div>

      {/* ─── New-conversation confirm — steering, not deletion: honest scope ─── */}
      <Modal
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Start a new conversation?"
        description="Consuela starts fresh — she won't remember this conversation, and this screen clears to a clean thread with a ✨ New conversation marker. Nothing is deleted: the older messages stay in today's family thread on the server."
        footer={
          <>
            <button
              onClick={() => setConfirmClearOpen(false)}
              className="flex-1 rounded-full border border-white/10 px-4 py-3 text-sm font-semibold text-text-primary tap-sm"
            >
              Cancel
            </button>
            <button
              onClick={clearChat}
              className="flex-1 rounded-full bg-[var(--color-accent-button,var(--color-accent-selected))] px-4 py-3 text-sm font-semibold text-white tap-sm"
            >
              Start new conversation
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm text-text-secondary">
          <span>Tip: you can also type <strong>/new</strong> or <strong>/restart</strong> in the message box — same effect, no confirmation.</span>
        </div>
      </Modal>

      <CapsuleNav />

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .chat-dot {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 9999px;
          background: var(--color-accent-selected);
        }
        .chat-dot-bounce {
          animation: bounce 1s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .chat-dot-bounce {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div role="status" className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--color-accent-selected)]" />
        <span className="sr-only">Loading conversation…</span>
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}
