/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
"use client";

import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import CapsuleNav from "@/components/ui/CapsuleNav";
import Avatar from "@/components/ui/Avatar";
import SigmaImage from "@/components/ui/SigmaImage";
import SyncStatusBanner from "@/components/ui/SyncStatusBanner";
import Modal from "@/components/ui/Modal";
import { Icon3D } from "@/components/3d";
import { UnifiedInput } from "@/components/chat/UnifiedInput";
import { streamConsuelaChat } from "@/lib/chat-stream";
import { FamilyBrief } from "./FamilyBrief";
import { OpenLoopChips } from "./OpenLoopChips";
import { messageOrigin, stripForSpeech } from "@/lib/consuela/chat-context";
import { speak, stopSpeaking, isSpeaking, isSpeechSupported } from "@/lib/consuela/speech";

import { db } from "@/db";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePendingChatQuery } from "@/hooks/usePendingChatQuery";

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  speaker?: string;
  speakerEmoji?: string;
  errorFor?: string;
  /** Telegram-mirrored row — wears an origin badge in the thread. */
  source?: "telegram";
}

const CHAT_STORAGE_KEY = "consuela-chat-messages";
const SPEAKER_STORAGE_KEY = "consuela-chat-speaker";

function EmojiSpan({ emoji, alt = "" }: { emoji: string; alt?: string }) {
  if (emoji && (emoji.startsWith("data:") || emoji.startsWith("http"))) {
    return (
      <span className="inline-block w-4 h-4 rounded-full overflow-hidden shrink-0">
        <SigmaImage src={emoji} alt={alt} shape="circle" />
      </span>
    );
  }
  return <span>{emoji}</span>;
}

function loadChatHistory(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const d = localStorage.getItem(CHAT_STORAGE_KEY);
    return d ? JSON.parse(d) : [];
  } catch { return []; }
}

function saveChatHistory(msgs: Message[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs)); } catch {}
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// Short beat so the orb animation doesn't flash on instant buffered replies.
const MIN_THINKING_DELAY = 400;

// Read the daily PB thread (union of dashboard + telegram messages).
// Returns [] on any failure so callers keep their localStorage state.
// Pass sinceISO to fetch only rows newer than that createdAt (incremental reconcile).
async function fetchPBThread(sinceISO?: string): Promise<{ messages: Message[]; latest: string | null }> {
  try {
    const params = new URLSearchParams({ threadId: todayISO() });
    if (sinceISO) params.set("since", sinceISO);
    const res = await fetch(`/api/chat/messages?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return { messages: [], latest: null };
    const json = await res.json();
    if (!json.ok || !Array.isArray(json.messages)) return { messages: [], latest: null };
    let latest: string | null = null;
    const messages = json.messages.map((m: any) => {
      if (m.createdAt && (!latest || String(m.createdAt) > latest)) latest = String(m.createdAt);
      return {
        id: pbSyntheticIdCounter++,
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content || "",
        timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        ...(m.role === "user" && m.userId ? { speaker: m.userId } : {}),
        ...(m.source === "telegram" ? { source: "telegram" as const } : {}),
      };
    });
    return { messages, latest };
  } catch { return { messages: [], latest: null }; }
}

// Merge PB rows into the local list without duplicating rows already shown.
// Keeps local rows (which may carry action cards) and appends anything new.
function mergePBThread(prev: Message[], pbMsgs: Message[]): Message[] {
  const keyOf = (m: Message) => `${m.role}:${m.speaker ?? ""}:${m.content}`;
  const countIn = (arr: Message[], k: string) => arr.reduce((n, m) => n + (keyOf(m) === k ? 1 : 0), 0);
  const merged = [...prev];
  for (const pm of pbMsgs) {
    const k = keyOf(pm);
    if (countIn(merged, k) < countIn(pbMsgs, k)) merged.push(pm);
  }
  return merged;
}

// Synthetic ids for PB-hydrated rows must be unique ACROSS reconciles, not
// just within one fetch — a per-fetch index collides (fetch #2's row can get
// the same id as fetch #1's) and duplicate React keys break list diffing.
// Monotonic global counter, module-scoped so every fetch keeps counting up.
let pbSyntheticIdCounter = 2_000_000;

const initialGreeting: Message = {
  id: 1,
  role: "assistant",
  // The hero already introduces Consuela; the seed message just opens the
  // door (no double introduction once the thread starts).
  content: "What can I help you with today? 🏡",
  timestamp: "Now",
};

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

  const [messages, setMessages] = useState<Message[]>([initialGreeting]);

  // Hydrate saved messages after mount (client only, avoids SSR mismatch)
  useEffect(() => {
    const saved = loadChatHistory();
    if (saved.length > 0) {
      setMessages(saved);
    }
  }, []);

  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  // Newest createdAt seen in the PB thread — post-send reconciles read only
  // rows after this watermark instead of refetching the whole day.
  const lastPBCreatedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // PB is the union of dashboard + telegram — it wins over the localStorage
      // seed when it has anything; otherwise keep the local history as-is.
      // Hydration stays a FULL read; only post-send reconciles go incremental.
      const { messages: pbMsgs, latest } = await fetchPBThread();
      if (cancelled) return;
      if (latest) lastPBCreatedRef.current = latest;
      if (pbMsgs.length > 0) {
        setMessages(pbMsgs);
      } else {
        const saved = loadChatHistory();
        if (saved.length > 0) setMessages(saved);
      }
      hydratedRef.current = true;
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hydrated && messages.length > 0) saveChatHistory(messages);
  }, [messages, hydrated]);

  const [isTyping, setIsTyping] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [showSpeakerPicker, setShowSpeakerPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const speakerPickerRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const reducedMotionRef = useRef(false);
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q");

  // Hero state: visible when fresh (no user messages yet) OR first reply is pending (orb animation plays while thinking)
  const userMessageCount = messages.filter(m => m.role === "user").length;
  const showHero = userMessageCount === 0 || (userMessageCount === 1 && isTyping);

  // Hide quick actions while Consuela is thinking — don't let them tap again
  const showQuickActions = userMessageCount === 0 && !isTyping;

  // ─── Read-aloud orb (pre-readers): the strip's mini orb speaks the last reply ───
  const lastAssistantReply = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.content.trim() && !m.errorFor) return m.content;
    }
    return null;
  }, [messages]);
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

  const msgCounter = useRef(Math.max(100, ...messages.map(m => m.id)));
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Spans the ENTIRE stream — the visual isTyping flag drops on the first
  // token (intended UX), so it can't also be the double-send guard.
  const streamInFlightRef = useRef(false);
  // Live AbortController for the in-flight stream — the stop button's handle.
  const abortRef = useRef<AbortController | null>(null);
  // Render-visible mirror of the ref: keeps the composer's send path disabled
  // for the whole stream so a mid-stream send can't be silently swallowed.
  const [composerLocked, setComposerLocked] = useState(false);

  const stopGenerating = () => {
    abortRef.current?.abort();
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping || streamInFlightRef.current) return;
    streamInFlightRef.current = true;
    setComposerLocked(true);
    const controller = new AbortController();
    abortRef.current = controller;

    msgCounter.current += 1;
    const userMsg: Message = {
      id: msgCounter.current,
      role: "user",
      content: trimmed,
      timestamp: "Just now",
      speaker: activeSpeaker.name,
      speakerEmoji: activeSpeaker.emoji,
    };

    setMessages(prev => [...prev, userMsg]);
    setPinnedToBottom(true);
    setIsTyping(true);
    setStatusLine(null);

    msgCounter.current += 1;
    const streamId = msgCounter.current;
    let bubbleOpen = false;
    // Whatever streamed before a stop/failure — a stopped reply keeps its words.
    let streamedSoFar = "";

    try {
      const t0 = Date.now();
      const { content, streamed } = await streamConsuelaChat({
        message: trimmed,
        history: messagesRef.current.slice(-12).map(m => ({
          role: m.role,
          content: m.role === "assistant"
            ? m.content.replace(/\n\n✅[\s\S]*$/, "").trim()
            : m.content,
        })),
        signal: controller.signal,
        onStatus: (label) => setStatusLine(label),
        onToken: (full) => {
          streamedSoFar = full;
          if (!bubbleOpen) { bubbleOpen = true; setIsTyping(false); }
          setMessages(prev => prev.some(m => m.id === streamId)
            ? prev.map(m => (m.id === streamId ? { ...m, content: full } : m))
            : [...prev, { id: streamId, role: "assistant" as const, content: full, timestamp: "Just now" }]);
        },
      });

      // Buffered fallback keeps a short beat so the orb doesn't flash;
      // streamed replies already rendered live.
      if (!streamed) {
        const elapsed = Date.now() - t0;
        if (elapsed < MIN_THINKING_DELAY) {
          await new Promise(r => setTimeout(r, MIN_THINKING_DELAY - elapsed));
        }
      }
      setIsTyping(false);
      setStatusLine(null);

      const finalContent = content || "I processed that.";
      setMessages(prev => prev.some(m => m.id === streamId)
        ? prev.map(m => (m.id === streamId ? { ...m, content: finalContent } : m))
        : [...prev, { id: streamId, role: "assistant" as const, content: finalContent, timestamp: "Just now" }]);

      // Reconcile against PB (picks up anything that arrived on other devices) —
      // incremental: only rows newer than the last watermark we've seen.
      // Safety window: Telegram rows land with their real send time, which can
      // predate the watermark — re-fetch 10 min back and let mergePBThread dedupe.
      const since = lastPBCreatedRef.current
        ? new Date(Date.parse(lastPBCreatedRef.current) - 10 * 60 * 1000).toISOString()
        : undefined;
      const { messages: fresh, latest } = await fetchPBThread(since);
      if (latest) lastPBCreatedRef.current = latest;
      if (fresh.length > 0) setMessages(prev => mergePBThread(prev, fresh));
    } catch (error) {
      setIsTyping(false);
      setStatusLine(null);

      if (controller.signal.aborted) {
        // User pressed stop — not an error. Keep whatever streamed; if nothing
        // did, say so plainly instead of dropping a silent hole in the thread.
        const stoppedContent = streamedSoFar.trim() || "Stopped.";
        setMessages(prev => prev.some(m => m.id === streamId)
          ? prev.map(m => (m.id === streamId ? { ...m, content: stoppedContent } : m))
          : [...prev, { id: streamId, role: "assistant" as const, content: stoppedContent, timestamp: "Just now" }]);
      } else {
        // Honest failure: name the problem (offline vs server) and the recovery.
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        const failedContent = offline
          ? "You're offline — I can't reach the family server right now. Check the connection and try again."
          : "I couldn't reach the family server just now. Your message is still here — try again in a moment.";
        msgCounter.current += 1;
        setMessages(prev => [...prev, {
          id: msgCounter.current,
          role: "assistant",
          content: failedContent,
          timestamp: "Just now",
          errorFor: trimmed,
        }]);
      }
    } finally {
      abortRef.current = null;
      streamInFlightRef.current = false;
      setComposerLocked(false);
    }
  };

  const retryMessage = (failedText: string, failedId: number) => {
    // Never remove the failed bubble unless the retry will actually run —
    // a mid-stream guard drop would otherwise eat the user's message.
    if (isTyping || streamInFlightRef.current) return;
    setMessages(prev => prev.filter(m => m.id !== failedId));
    sendMessage(failedText);
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
  const clearChat = () => {
    setMessages([initialGreeting]);
    saveChatHistory([initialGreeting]);
    setConfirmClearOpen(false);
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
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
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
          aria-label="Clear conversation"
          title="Clear chat"
          className="relative w-8 h-8 flex items-center justify-center rounded-2xl glass-subtle text-text-secondary hover:text-text-primary transition-colors shrink-0 after:absolute after:-inset-1.5 after:content-['']"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6M5 6l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14" />
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
            {isTyping ? (
              <div className="flex flex-col items-center pt-4">
                <div className="relative w-[200px] h-[200px] flex items-center justify-center chat-hero-enter">
                  <div
                    className="chat-ambient-glow absolute inset-0 rounded-full"
                    style={{
                      background: "radial-gradient(circle, color-mix(in srgb, var(--color-accent-selected) 50%, transparent) 0%, color-mix(in srgb, var(--color-accent-selected) 20%, transparent) 40%, transparent 70%)",
                      filter: "blur(24px)",
                    }}
                  />
                  <div
                    className="w-[140px] h-[140px] rounded-full chat-orb-think"
                    style={{
                      background: "radial-gradient(circle at 40% 35%, color-mix(in srgb, var(--color-accent-selected) 85%, white) 0%, color-mix(in srgb, var(--color-accent-selected) 60%, transparent) 35%, color-mix(in srgb, var(--color-accent-selected) 20%, transparent) 70%, transparent 100%)",
                      boxShadow: "0 0 80px color-mix(in srgb, var(--color-accent-selected) 40%, transparent), 0 0 160px color-mix(in srgb, var(--color-accent-selected) 12%, transparent), inset 0 2px 0 rgba(255,255,255,0.2)",
                    }}
                  />
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200" aria-hidden>
                    {[0, 1, 2, 3, 4].map((i) => {
                      const phase = i / 5;
                      const strokeAlpha = 0.55 - phase * 0.4;
                      const strokeWidth = 2.0 - phase * 0.35;
                      return (
                        <circle
                          key={i}
                          cx="100" cy="100" r="78"
                          fill="none"
                          style={{
                            stroke: `color-mix(in srgb, var(--color-accent-selected) ${Math.round(strokeAlpha * 100)}%, transparent)`,
                            strokeWidth,
                            animationDelay: `${(phase * 1.8).toFixed(2)}s`,
                            transformOrigin: "100px 100px",
                          }}
                          className="chat-ripple"
                        />
                      );
                    })}
                  </svg>
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 200 200" aria-hidden>
                    <circle
                      cx="100" cy="100" r="88"
                      fill="none"
                      style={{ stroke: "color-mix(in srgb, var(--color-accent-selected) 40%, transparent)" }}
                      strokeWidth="1.0"
                      strokeDasharray="6 14"
                      strokeLinecap="round"
                      className="chat-hero-ring-fast"
                    />
                  </svg>
                </div>
                <p className="text-sm text-text-secondary mt-3 chat-hero-enter chat-hero-enter-delay-100">
                  Thinking…
                </p>
              </div>
            ) : (
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
            )}

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
        {!showHero && messages.map((msg) => (
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

              <span className="text-[11px] text-text-secondary px-1">{msg.timestamp}</span>
            </div>
          </div>
        ))}

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
          sendDisabled={isTyping || composerLocked}
          streaming={isTyping || composerLocked}
          onStop={stopGenerating}
          showTip={userMessageCount === 0}
        />
      </div>

      {/* ─── Clear-conversation confirmation — destructive action, honest scope ─── */}
      <Modal
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Clear this conversation?"
        description="This clears the chat on this device only. The family thread is kept on the home server and comes back next time the day's messages load."
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
              className="flex-1 rounded-full bg-[var(--color-accent-rose)] px-4 py-3 text-sm font-semibold text-white tap-sm"
            >
              Clear conversation
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm text-text-secondary">
          <span>Messages shared to the family thread (including from Telegram) are not deleted.</span>
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
