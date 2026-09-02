/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
"use client";

import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import CapsuleNav from "@/components/ui/CapsuleNav";
import Avatar from "@/components/ui/Avatar";
import SigmaImage from "@/components/ui/SigmaImage";
import { Icon3D } from "@/components/3d";
import { UnifiedInput } from "@/components/chat/UnifiedInput";
import { streamConsuelaChat } from "@/lib/chat-stream";

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
async function fetchPBThread(): Promise<Message[]> {
  try {
    const res = await fetch(`/api/chat/messages?threadId=${todayISO()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.ok || !Array.isArray(json.messages)) return [];
    return json.messages.map((m: any, i: number) => ({
      id: 1000000 + i,
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content || "",
      timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      ...(m.role === "user" && m.userId ? { speaker: m.userId } : {}),
    }));
  } catch { return []; }
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

const initialGreeting: Message = {
  id: 1,
  role: "assistant",
  content: "Hey there! 👋 I'm Consuela, your family assistant. I can help you manage your calendar, plan meals, organize tasks, and build grocery lists.\n\nJust tell me what you need!",
  timestamp: "Now",
};

const quickActions = [
  { icon: "calendar" as const, label: "Add Event", prompt: "Add soccer practice tomorrow at 4pm for Caspian" },
  { icon: "meals" as const, label: "Plan Meals", prompt: "Plan dinners for this week" },
  { icon: "tasks" as const, label: "Assign Chore", prompt: "Assign trash duty to Caspian every Thursday with 10 points" },
  { icon: "grocery" as const, label: "Grocery List", prompt: "Generate grocery list for this week's meals" },
];

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderContent(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const bold = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return (
      <span key={i}>
        <span dangerouslySetInnerHTML={{ __html: bold }} />
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

function ChatContent() {
  const membersData = useMemo(() => db.selectMembers(), []);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // PB is the union of dashboard + telegram — it wins over the localStorage
      // seed when it has anything; otherwise keep the local history as-is.
      const pbMsgs = await fetchPBThread();
      if (cancelled) return;
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

  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [showSpeakerPicker, setShowSpeakerPicker] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
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

  useEffect(() => {
    if (typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = "en-US";
      recognitionRef.current.onresult = (event: any) => {
        setInput(event.results[0][0].transcript);
        setIsListening(false);
      };
      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
    return () => { if (recognitionRef.current) recognitionRef.current.stop(); };
  }, []);

  const msgCounter = useRef(Math.max(100, ...messages.map(m => m.id)));
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Spans the ENTIRE stream — the visual isTyping flag drops on the first
  // token (intended UX), so it can't also be the double-send guard.
  const streamInFlightRef = useRef(false);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping || streamInFlightRef.current) return;
    streamInFlightRef.current = true;

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
    setInput("");
    setIsTyping(true);
    setStatusLine(null);

    msgCounter.current += 1;
    const streamId = msgCounter.current;
    let bubbleOpen = false;

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
        onStatus: (label) => setStatusLine(label),
        onToken: (full) => {
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

      // Reconcile against PB (picks up anything that arrived on other devices).
      const pbMsgs = await fetchPBThread();
      if (pbMsgs.length > 0) setMessages(prev => mergePBThread(prev, pbMsgs));
    } catch (error) {
      setIsTyping(false);
      setStatusLine(null);
      msgCounter.current += 1;
      setMessages(prev => [...prev, {
        id: msgCounter.current,
        role: "assistant",
        content: "Sorry, I'm having trouble right now.",
        timestamp: "Just now",
        errorFor: trimmed,
      }]);
    } finally {
      streamInFlightRef.current = false;
    }
  };

  const retryMessage = (failedText: string, failedId: number) => {
    setMessages(prev => prev.filter(m => m.id !== failedId));
    sendMessage(failedText);
  };

  const clearChat = () => {
    setMessages([initialGreeting]);
    saveChatHistory([initialGreeting]);
  };

  // Deep-link query: /chat?q=... fires the query exactly once, after the
  // thread has hydrated, and strips the param from the URL immediately.
  usePendingChatQuery(queryParam, hydrated, sendMessage);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    isListening ? recognitionRef.current.stop() : recognitionRef.current.start();
    setIsListening(!isListening);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="page-settle min-h-screen max-w-lg mx-auto flex flex-col relative bg-surface-0">

      {/* ─── Top bar ─── */}
      <div
        className="sticky top-0 z-40 mx-3 sm:mx-4 mt-3 px-3 sm:px-4 py-3 glass-strong rounded-3xl flex items-center gap-2 sm:gap-3"
        style={{ marginTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      >
        <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-lg shrink-0"
          style={{ background: "linear-gradient(135deg, var(--color-accent-violet), var(--color-accent-lavender))", boxShadow: "0 0 16px rgba(124,111,247,0.3)" }}
        >
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-text-primary truncate">Consuela</h1>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
            <span className="text-[10px] text-text-secondary truncate">AI Family Assistant</span>
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
              className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-2xl glass-subtle text-text-secondary hover:text-text-primary transition-colors text-xs before:absolute before:-inset-1.5 before:content-['']"
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
                      currentSpeaker.name === m.name ? "text-[var(--color-accent-violet)] bg-[var(--color-accent-violet)]/10" : "text-text-primary"
                    }`}
                  >
                    <EmojiSpan emoji={m.emoji} alt={m.name} />
                    <span>{m.name}</span>
                    {currentSpeaker.name === m.name && <span className="ml-auto text-[var(--color-accent-violet)]">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={clearChat}
          aria-label="Clear conversation"
          title="Clear chat"
          className="relative w-8 h-8 flex items-center justify-center rounded-2xl glass-subtle text-text-secondary hover:text-text-primary transition-colors shrink-0 before:absolute before:-inset-1.5 before:content-['']"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6M5 6l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14" />
          </svg>
        </button>
      </div>

      {/* ─── Messages area ─── */}
      <div
        ref={scrollAreaRef}
        onScroll={handleMessagesScroll}
        role="log"
        aria-label="Conversation with Consuela"
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {/* Hero greeting state */}
        {showHero && (
          <div className="flex flex-col items-center pt-10 pb-6">
            {/* Orb + ring container */}
            <div className="relative w-[200px] h-[200px] flex items-center justify-center chat-hero-enter">
              {/* Ambient glow — large soft halo behind the orb, visible only while thinking */}
              {isTyping && (
                <div
                  className="chat-ambient-glow absolute inset-0 rounded-full"
                  style={{
                    background: "radial-gradient(circle, rgba(167,139,250,0.5) 0%, rgba(124,111,247,0.2) 40%, transparent 70%)",
                    filter: "blur(24px)",
                  }}
                />
              )}

              {/* Glowing orb — elastic morph when thinking */}
              <div
                className={`w-[140px] h-[140px] rounded-full ${isTyping ? "chat-orb-think" : "chat-hero-orb"}`}
                style={{
                  background: "radial-gradient(circle at 40% 35%, rgba(167,139,250,0.9) 0%, rgba(124,111,247,0.6) 35%, rgba(99,102,241,0.2) 70%, transparent 100%)",
                  boxShadow: `0 0 80px rgba(124,111,247,${isTyping ? "0.40" : "0.25"}), 0 0 160px rgba(167,139,250,0.12), inset 0 2px 0 rgba(255,255,255,0.2)`,
                }}
              />

              {/* Siri-style concentric ripple rings — 5 rings staggered evenly across 1.8s */}
              {isTyping && (
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                  {[0, 1, 2, 3, 4].map((i) => {
                    const phase = i / 5;
                    const strokeAlpha = 0.55 - phase * 0.4;
                    const strokeWidth = 2.0 - phase * 0.35;
                    return (
                      <circle
                        key={i}
                        cx="100" cy="100" r="78"
                        fill="none"
                        stroke={`rgba(192,132,252,${strokeAlpha.toFixed(2)})`}
                        strokeWidth={strokeWidth}
                        className="chat-ripple"
                        style={{
                          animationDelay: `${(phase * 1.8).toFixed(2)}s`,
                          transformOrigin: "100px 100px",
                        }}
                      />
                    );
                  })}
                </svg>
              )}

              {/* Dotted ring — spins faster while thinking */}
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 200 200">
                <circle
                  cx="100" cy="100" r="88"
                  fill="none"
                  stroke="rgba(192,132,252,0.40)"
                  strokeWidth="1.0"
                  strokeDasharray="6 14"
                  strokeLinecap="round"
                  className={isTyping ? "chat-hero-ring-fast" : "chat-hero-ring"}
                />
                <circle
                  cx="100" cy="100" r="88"
                  fill="none"
                  stroke="rgba(147,51,234,0.25)"
                  strokeWidth="0.6"
                  strokeDasharray="3 17"
                  strokeLinecap="round"
                  style={{ animation: `chatRingSweep${isTyping ? "Fast" : ""} 25s linear infinite reverse` }}
                />
              </svg>
            </div>

            {/* Greeting / thinking text */}
            {isTyping ? (
              <p className="text-sm text-text-secondary mt-3 chat-hero-enter chat-hero-enter-delay-100">
                Thinking…
              </p>
            ) : (
              <>
                <h1 className="text-2xl font-bold mt-2 chat-hero-enter chat-hero-enter-delay-100"
                  style={{
                    background: "linear-gradient(135deg, var(--color-accent-violet), var(--color-accent-lavender))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  Hi, I&apos;m Consuela
                </h1>
                <p className="text-sm text-text-secondary mt-1 chat-hero-enter chat-hero-enter-delay-200">
                  What can I help you with today?
                </p>
              </>
            )}

            {/* Quick action chips — hidden while thinking */}
            {showQuickActions && (
            <div className="grid grid-cols-2 gap-3 w-full mt-6 chat-hero-enter chat-hero-enter-delay-300">
              {quickActions.map((a) => (
                <button
                  key={a.label}
                  onClick={() => sendMessage(a.prompt)}
                  className="liquid-glass flex items-center gap-4 px-5 py-4 text-left group"
                  style={{ background: "linear-gradient(135deg, rgba(124,111,247,0.24) 0%, rgba(124,111,247,0.10) 100%)" }}
                >
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                    style={{ background: "linear-gradient(135deg, rgba(124,111,247,0.4), rgba(167,139,250,0.2))" }}
                  >
                    <Icon3D variant={a.icon} size="md" animated={false} className="w-6 h-6" />
                  </div>
                  <span className="text-sm font-medium text-text-primary">{a.label}</span>
                </button>
              ))}
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
                  background: "linear-gradient(135deg, rgba(124,111,247,0.3), rgba(167,139,250,0.15))",
                  boxShadow: "0 0 12px rgba(124,111,247,0.15)",
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
              {msg.role === "user" && msg.speaker && (
                <span className="text-[10px] text-text-secondary px-1">{msg.speaker.split(" ")[0]}</span>
              )}
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed break-words [overflow-wrap:anywhere] ${
                  msg.role === "user"
                    ? "text-white rounded-tr-md"
                    : "rounded-tl-md text-text-primary"
                }`}
                style={
                  msg.role === "user"
                    ? { background: "linear-gradient(135deg, var(--color-accent-violet), var(--color-accent-lavender))" }
                    : {
                        background: "linear-gradient(135deg, rgba(124,111,247,0.18) 0%, rgba(124,111,247,0.08) 100%)",
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
                  className="tap-sm relative inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full glass-subtle px-4 py-2.5 text-xs font-semibold text-[var(--color-accent-violet)]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Try again
                </button>
              )}

              <span className="text-[10px] text-text-secondary px-1">{msg.timestamp}</span>
            </div>
          </div>
        ))}

        {isTyping && (
          <div role="status" aria-live="polite" className="flex gap-2.5">
            <div className="w-8 h-8 rounded-2xl flex items-center justify-center text-sm shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(124,111,247,0.3), rgba(167,139,250,0.15))",
                boxShadow: "0 0 12px rgba(124,111,247,0.15)",
              }}
            >
              ✨
            </div>
            <div
              className="rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1"
              style={{
                background: "linear-gradient(135deg, rgba(124,111,247,0.12) 0%, rgba(124,111,247,0.06) 100%)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {statusLine ? (
                <span className="text-xs text-text-secondary whitespace-nowrap">{statusLine}</span>
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
        <UnifiedInput onSendMessage={sendMessage} disabled={isTyping} />
      </div>

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
          background: var(--color-accent-violet);
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
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--color-accent-violet)]" />
        <span className="sr-only">Loading conversation…</span>
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}
