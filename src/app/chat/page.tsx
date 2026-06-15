/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
"use client";

import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import BottomNav from "@/components/ui/BottomNav";
import Avatar from "@/components/ui/Avatar";
import SigmaImage from "@/components/ui/SigmaImage";
import { Icon3D } from "@/components/3d";

import { db } from "@/db";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  actions?: ActionCard[];
  speaker?: string;
  speakerEmoji?: string;
}

type LocalActionType =
  | "event"
  | "meal"
  | "task"
  | "grocery"
  | "recipe"
  | "reward"
  | "clear"
  | "schedule";

type HermesActionType =
  | LocalActionType
  | "add_event"
  | "remove_event"
  | "add_task"
  | "complete_task"
  | "clear_leaderboard"
  | "add_meal"
  | "remove_meal"
  | "update_grocery"
  | "update_pantry"
  | "send_message";

interface ActionCard {
  type: HermesActionType;
  title: string;
  detail?: string;
  emoji?: string;
  data?: any;
  confirmed?: boolean;
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

const actionAccentBg: Record<string, string> = {
  event: "linear-gradient(135deg, rgba(124,111,247,0.18) 0%, rgba(124,111,247,0.06) 100%)",
  meal: "linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.06) 100%)",
  task: "linear-gradient(135deg, rgba(6,182,212,0.18) 0%, rgba(6,182,212,0.06) 100%)",
  grocery: "linear-gradient(135deg, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0.06) 100%)",
  recipe: "linear-gradient(135deg, rgba(244,63,94,0.18) 0%, rgba(244,63,94,0.06) 100%)",
  reward: "linear-gradient(135deg, rgba(234,179,8,0.18) 0%, rgba(234,179,8,0.06) 100%)",
};

const actionAccentBorder: Record<string, string> = {
  event: "rgba(124,111,247,0.30)",
  meal: "rgba(245,158,11,0.30)",
  task: "rgba(6,182,212,0.30)",
  grocery: "rgba(59,130,246,0.30)",
  recipe: "rgba(244,63,94,0.30)",
  reward: "rgba(234,179,8,0.30)",
};

function renderContent(text: string) {
  return text.split("\n").map((line, i) => {
    const bold = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return (
      <span key={i}>
        <span dangerouslySetInnerHTML={{ __html: bold }} />
        {i < text.split("\n").length - 1 && <br />}
      </span>
    );
  });
}

async function executeAction(action: ActionCard): Promise<{ success: boolean; message: string }> {
  try {
    const payload = (action as any).data;
    const detailFromAction = action.detail;

    const getEmoji = () => action.emoji || payload?.emoji || "✨";
    const getTitle = () => action.title || payload?.title || action.detail || "";

    const getDetailString = () => {
      if (typeof detailFromAction === "string") return detailFromAction;
      if (typeof payload === "string") return payload;
      if (payload && typeof payload === "object") {
        if (payload?.assignedTo && payload?.points) {
          return `${payload.assignedTo} ${payload.points}pts`;
        }
        if (payload?.member && payload?.time) {
          return `${payload.member} · ${payload.time}`;
        }
        if (payload?.items && Array.isArray(payload.items)) {
          return payload.items.join("· ");
        }
      }
      return "";
    };

    const normalizedAction: ActionCard = {
      ...action,
      title: getTitle(),
      emoji: getEmoji(),
      detail: getDetailString(),
    };

    switch (normalizedAction.type) {
      case "meal": {
        const MEALS_KEY = "consuela-meals";
        const dayMatch = normalizedAction.detail?.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i);
        const dayMap: Record<string, string> = {
          monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
          friday: "Fri", saturday: "Sat", sunday: "Sun",
        };
        let day = "Mon";
        if (dayMatch) {
          const raw = dayMatch[1].toLowerCase();
          day = dayMap[raw] || raw.charAt(0).toUpperCase() + raw.slice(1, 3);
        }
        const typeMatch = normalizedAction.detail?.match(/\b(breakfast|lunch|dinner|snack)\b/i);
        const mealType = typeMatch ? typeMatch[1].toLowerCase() as any : "dinner";
        const newMeal = {
          id: Date.now(),
          name: action.title,
          emoji: action.emoji || "🍽️",
          time: day,
          mealType,
          prepTime: "30 min",
          tags: ["AI Suggested"],
          ingredients: [] as string[],
          servings: 4,
          calories: 500,
          userId: "demo",
        };
        await db.insertMeal(newMeal);
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(MEALS_KEY);
            const meals = stored ? JSON.parse(stored) : [];
            meals.push(newMeal);
            localStorage.setItem(MEALS_KEY, JSON.stringify(meals));
          } catch {}
        }
        return { success: true, message: `Added "${action.title}" to ${day}` };
      }
      case "task": {
        const TASKS_KEY = "consuela-tasks";
        const stored = (() => {
          if (typeof window === "undefined") return [];
          try { const d = localStorage.getItem(TASKS_KEY); return d ? JSON.parse(d) : []; } catch { return []; }
        })();
        const members = db.selectMembers();
        const assignee = action.detail?.match(/^(\w+)/)?.[1] || members[0]?.name || "Caspian";
        const member = members.find((m: any) => m.name === assignee || m.name.startsWith(assignee));
        const points = parseInt(action.detail?.match(/(\d+)\s*pts?/)?.[1] || "10");
        stored.push({
          id: Date.now(), title: action.title, assignee: member?.name || assignee,
          assigneeEmoji: member?.emoji || "🧒", due: "Today", points,
          recurring: null, category: "AI Suggested", completed: false, priority: "medium" as const,
        });
        if (typeof window !== "undefined") localStorage.setItem(TASKS_KEY, JSON.stringify(stored));
        return { success: true, message: `Created task "${action.title}" for ${member?.name || assignee} (${points}pts)` };
      }
      case "grocery": {
        await db.upsertGroceryItem({
          name: action.title, category: "pantry", aisle: "1", quantity: "1",
          priority: "medium", needed: true, source: "ai", autoGenerated: false, userId: "demo",
        });
        return { success: true, message: `Added "${action.title}" to grocery list` };
      }
      case "event": {
        const EVENTS_KEY = "consuela-events";
        const stored = (() => {
          if (typeof window === "undefined") return [];
          try { const d = localStorage.getItem(EVENTS_KEY); return d ? JSON.parse(d) : []; } catch { return []; }
        })();
        stored.push({
          id: Date.now(), title: action.title, time: "4:00 PM",
          member: action.detail?.split("·")?.[0]?.trim() || "All",
          color: "green" as const, emoji: action.emoji || "📅", day: new Date().getDate(),
        });
        if (typeof window !== "undefined") localStorage.setItem(EVENTS_KEY, JSON.stringify(stored));
        return { success: true, message: `Added event "${action.title}"` };
      }
      case "recipe": {
        const RECIPES_KEY = "consuela-recipes";
        const newRecipe = {
          id: Date.now(),
          name: action.title,
          emoji: action.emoji || "📖",
          prepTime: action.detail?.match(/(\d+\s*min)/)?.[1] || "30 min",
          tags: ["AI Created"],
          ingredients: action.detail?.split("·").map((s: string) => s.trim()).filter(Boolean) || [],
          instructions: action.detail || "",
          servings: 4,
          calories: 500,
          createdAt: new Date().toISOString(),
        };
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(RECIPES_KEY);
            const recipes = stored ? JSON.parse(stored) : [];
            recipes.push(newRecipe);
            localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
          } catch {}
        }
        return { success: true, message: `Created recipe "${action.title}"` };
      }
      case "reward": {
        const REWARDS_KEY = "consuela-rewards";
        const points = parseInt(action.detail?.match(/(\d+)/)?.[1] || "50");
        const newReward = { id: Date.now(), name: action.title, emoji: action.emoji || "🎁", cost: points };
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(REWARDS_KEY);
            const rewards = stored ? JSON.parse(stored) : [];
            rewards.push(newReward);
            localStorage.setItem(REWARDS_KEY, JSON.stringify(rewards));
          } catch {}
        }
        return { success: true, message: `Added reward "${action.title}" (${points}pts)` };
      }
      case "clear": {
        if (typeof window !== "undefined") {
          localStorage.removeItem("consuela-points");
        }
        return { success: true, message: "Cleared leaderboard" };
      }
      default:
        return { success: false, message: `Unknown action type` };
    }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed" };
  }
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

  useEffect(() => {
    const saved = loadChatHistory();
    if (saved.length > 0) {
      setMessages(saved);
    }
    hydratedRef.current = true;
  }, []);

  const queryParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (hydratedRef.current && messages.length > 0) saveChatHistory(messages);
  }, [messages]);

  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showSpeakerPicker, setShowSpeakerPicker] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q");

  // Hero state: visible when fresh (no user messages yet) OR first reply is pending (orb animation plays while thinking)
  const userMessageCount = messages.filter(m => m.role === "user").length;
  const showHero = userMessageCount === 0 || (userMessageCount === 1 && isTyping);

  // Hide quick actions while Consuela is thinking — don't let them tap again
  const showQuickActions = userMessageCount === 0 && !isTyping;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (queryParam) {
      queryParamRef.current = queryParam;
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("q");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [queryParam]);

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

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    msgCounter.current += 1;
    const userMsg: Message = {
      id: msgCounter.current,
      role: "user",
      content: text.trim(),
      timestamp: "Just now",
      speaker: activeSpeaker.name,
      speakerEmoji: activeSpeaker.emoji,
    };

    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setIsTyping(true);

    try {
      const t0 = Date.now();
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: (() => {
            const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const events = db.selectTodaysEvents();
            const schedules = db.selectTodaysSchedules();
            const tasks = db.selectPendingTasks();
            const meals = db.selectMeals();
            const members = db.selectMembers();

            let ctx = `Current date: ${today}. Current speaker: ${activeSpeaker.name}. Family: ${memberOptions.map(m => `${m.name} (${m.emoji?.startsWith('data:') ? '🖼️' : m.emoji})`).join(", ")}.`;

            if (events.length > 0) {
              ctx += ` Today's events: ${events.map((e: any) => `${e.title} at ${e.time} (${e.member})`).join("; ")}.`;
            }
            if (schedules.length > 0) {
              ctx += ` Today's schedule: ${schedules.slice(0, 8).map((s: any) => `${s.time} ${s.title}`).join("; ")}.`;
            }
            if (tasks.length > 0) {
              ctx += ` Pending tasks: ${tasks.map((t: any) => `${t.title} (${t.assigned}, ${t.points}pts)`).join("; ")}.`;
            }
            if (meals.length > 0) {
              const weekMeals = meals.filter((m: any) => m.time).map((m: any) => `${m.time}: ${m.name}`).join(", ");
              if (weekMeals) ctx += ` This week's meals: ${weekMeals}.`;
            }
            return ctx;
          })(),
        }),
      });
      const aiResponse = await res.json();

      // Minimum 2s delay so the hero orb animation plays fully —
      // also creates a buffer that absorbs connectivity jitter gracefully.
      const MIN_THINKING_DELAY = 2000;
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_THINKING_DELAY) {
        await new Promise(r => setTimeout(r, MIN_THINKING_DELAY - elapsed));
      }

      setIsTyping(false);

      const actions = aiResponse.actions || [];
      const executedActions = await Promise.all(actions.map(async (action: ActionCard) => {
        const result = await executeAction(action);
        return { ...action, confirmed: result.success };
      }));

      const resultMsgs = executedActions
        .filter((a: ActionCard) => a.confirmed)
        .map((a: ActionCard) => `✅ ${a.title}`);
      const content = aiResponse.content || aiResponse.reply || "I processed that.";
      const fullContent = resultMsgs.length > 0 ? content + "\n\n" + resultMsgs.join("\n") : content;

      msgCounter.current += 1;
      const response: Message = {
        id: msgCounter.current,
        role: "assistant",
        content: fullContent,
        timestamp: "Just now",
        actions: executedActions,
      };
      setMessages(prev => [...prev, response]);
    } catch (error) {
      setIsTyping(false);
      msgCounter.current += 1;
      setMessages(prev => [...prev, {
        id: msgCounter.current,
        role: "assistant",
        content: "Sorry, I'm having trouble right now. Please try again.",
        timestamp: "Just now",
      }]);
    }
  };

  const clearChat = () => {
    setMessages([initialGreeting]);
    saveChatHistory([initialGreeting]);
  };

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
    <div className="min-h-screen max-w-lg mx-auto flex flex-col relative bg-surface-0">

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
          <div className="relative shrink-0">
            <button
              onClick={() => setShowSpeakerPicker(!showSpeakerPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-2xl glass-subtle text-text-secondary hover:text-text-primary transition-colors text-xs"
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
                onClick={() => setShowSpeakerPicker(false)}
              >
                {memberOptions.map(m => (
                  <button
                    key={m.name}
                    onClick={() => saveSpeaker(m)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      currentSpeaker.name === m.name ? "text-[var(--color-accent-violet)] bg-[var(--color-accent-violet)]/10" : "text-text-primary"
                    }`}
                    onMouseEnter={(e) => { if (currentSpeaker.name !== m.name) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={(e) => { if (currentSpeaker.name !== m.name) e.currentTarget.style.background = ""; }}
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
          className="w-8 h-8 flex items-center justify-center rounded-2xl glass-subtle text-text-secondary hover:text-text-primary transition-colors shrink-0"
          title="Clear chat"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6M5 6l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14" />
          </svg>
        </button>
      </div>

      {/* ─── Messages area ─── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
                Listening…
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
            <div className={`max-w-[82%] space-y-2 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
              {msg.role === "user" && msg.speaker && (
                <span className="text-[10px] text-text-muted px-1">{msg.speaker.split(" ")[0]}</span>
              )}
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
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

              {msg.actions?.map((action, i) => (
                <div key={i}
                  className="rounded-2xl px-3 py-2.5 flex items-center gap-2.5 w-full max-w-xs"
                  style={{
                    background: actionAccentBg[action.type] || actionAccentBg.event,
                    border: `1px solid ${actionAccentBorder[action.type] || actionAccentBorder.event}`,
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  <span className="text-lg shrink-0">{action.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{action.title}</p>
                    <p className="text-[10px] text-text-secondary truncate">{action.detail}</p>
                  </div>
                  {action.confirmed && (
                    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--color-accent-violet)" }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}

              <span className="text-[10px] text-text-muted px-1">{msg.timestamp}</span>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex gap-2.5">
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
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-2 h-2 rounded-full"
                  style={{
                    background: "var(--color-accent-violet)",
                    animation: `bounce 1s ease-in-out ${i * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ─── Input area ─── */}
      <div
        className="sticky bottom-0 z-50 px-4 pb-20 pt-2"
        style={{
          background: "linear-gradient(to top, var(--color-surface-0) 65%, transparent)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 7rem)",
        }}
      >
        {/* Input bar */}
        <div className="flex items-end gap-2 rounded-3xl px-3 py-2"
          style={{
            background: "linear-gradient(135deg, rgba(124,111,247,0.22) 0%, rgba(124,111,247,0.10) 100%)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(167,139,250,0.20)",
            boxShadow: "0 8px 32px rgba(124,111,247,0.12), inset 0 1px 0 rgba(255,255,255,0.12)",
          }}
        >
          {/* Mic button */}
          <button onClick={toggleListening}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors shrink-0 mb-0.5 ${
              isListening ? "text-rose-400 bg-rose-500/15" : "text-text-secondary hover:text-[var(--color-accent-violet)]"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" strokeLinecap="round" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" strokeLinecap="round" />
              <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
              <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
            </svg>
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message Consuela as ${activeSpeaker.name.split(" ")[0]}…`}
            rows={1}
            suppressHydrationWarning
            className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-muted resize-none outline-none leading-relaxed py-1.5 max-h-28"
            style={{ minHeight: "36px" }}
          />

          {/* Send button */}
          <button onClick={() => sendMessage(input)} disabled={!input.trim()}
            className={`w-9 h-9 flex items-center justify-center rounded-full shrink-0 mb-0.5 transition-all ${
              input.trim()
                ? "text-white active:scale-95"
                : "text-text-muted cursor-not-allowed"
            }`}
            style={input.trim()
              ? { background: "linear-gradient(135deg, var(--color-accent-violet), var(--color-accent-lavender))", boxShadow: "0 4px 12px rgba(124,111,247,0.35)" }
              : { background: "rgba(255,255,255,0.04)" }
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
              <path d="M22 2L11 13" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <BottomNav />

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500" /></div>}>
      <ChatContent />
    </Suspense>
  );
}
