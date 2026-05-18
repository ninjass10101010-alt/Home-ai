"use client";

import { useState, useRef, useEffect } from "react";
import BottomNav from "@/components/ui/BottomNav";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import pb from "@/lib/pocketbase";
import { Icon3D } from "@/components/3d";
// Deleted server action import removed

interface Message {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  actions?: ActionCard[];
}

interface ActionCard {
  type: "event" | "meal" | "task" | "grocery";
  title: string;
  detail: string;
  emoji: string;
  confirmed?: boolean;
}

const initialMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    content:
      "Hey there! 👋 I'm Consuela, your family assistant. I can help you manage your calendar, plan meals, organize tasks, and build grocery lists.\n\nJust tell me what you need!",
    timestamp: "Now",
  },
];

const suggestedPrompts = [
  { label: "📅 Add event", prompt: "Add soccer practice tomorrow at 4pm for Jake" },
  { label: "🍽️ Plan meals", prompt: "Plan dinners for this week" },
  { label: "✅ Assign chore", prompt: "Assign trash duty to Jake every Thursday" },
  { label: "🛒 Grocery list", prompt: "Generate grocery list for this week's meals" },
  { label: "📊 Family update", prompt: "What does the family have going on this week?" },
  { label: "🔔 Reminder", prompt: "Remind Dad about car service on Friday at 10am" },
];

const mockResponses: Record<string, Message> = {
  soccer: {
    id: 0,
    role: "assistant",
    content: "Done! I've added **Soccer Practice** to Jake's calendar for tomorrow at 4:00 PM. I'll send Jake a reminder an hour before. 📅",
    timestamp: "Just now",
    actions: [
      {
        type: "event",
        title: "Soccer Practice",
        detail: "Jake · Tomorrow · 4:00 PM",
        emoji: "⚽",
        confirmed: true,
      },
    ],
  },
  meal: {
    id: 0,
    role: "assistant",
    content:
      "Here's a meal plan for this week based on your family's preferences and what's in your pantry:\n\n**Mon** — Pasta Primavera 🍝\n**Tue** — Taco Night 🌮\n**Wed** — Grilled Chicken & Veggies 🍗\n**Thu** — Shrimp Stir Fry 🥢\n**Fri** — Homemade Pizza 🍕\n**Sat** — BBQ Night 🍖\n**Sun** — Slow Cooker Chili 🫕\n\nShould I generate the grocery list for these meals?",
    timestamp: "Just now",
    actions: [
      {
        type: "meal",
        title: "7-Day Meal Plan Created",
        detail: "Tap 'Meals' to view and edit",
        emoji: "🍽️",
        confirmed: true,
      },
    ],
  },
  chore: {
    id: 0,
    role: "assistant",
    content:
      "Got it! I've set up a **recurring chore** for Jake: take out the trash every Thursday evening. He'll earn **10 points** per completion. 💪\n\nWant me to set a reminder for him at a specific time?",
    timestamp: "Just now",
    actions: [
      {
        type: "task",
        title: "Take Out Trash",
        detail: "Jake · Every Thursday · 10pts",
        emoji: "🗑️",
        confirmed: true,
      },
    ],
  },
  grocery: {
    id: 0,
    role: "assistant",
    content:
      "Based on this week's meal plan, here's your grocery list:\n\n🥩 Chicken breast · Shrimp · Ground beef\n🥦 Broccoli · Bell peppers · Zucchini\n🧀 Mozzarella · Parmesan\n🍅 Crushed tomatoes · Pasta sauce\n🌮 Taco shells · Salsa · Sour cream\n\nAdded **14 items** to your grocery list. Want me to organize by store section?",
    timestamp: "Just now",
    actions: [
      {
        type: "grocery",
        title: "Grocery List Updated",
        detail: "14 items added · Tap to view",
        emoji: "🛒",
        confirmed: true,
      },
    ],
  },
  week: {
    id: 0,
    role: "assistant",
    content:
      "Here's the family's week at a glance:\n\n**Monday** — Jake: Soccer 4pm\n**Tuesday** — Lily: Piano 3pm, Taco Night 🌮\n**Wednesday** — Family: Movie Night\n**Thursday** — Jake: Trash duty, Dad: Car service\n**Friday** — Lily: Dentist 2pm, Pizza Night 🍕\n**Saturday** — Family: Park picnic (tentative)\n\nYou have **3 pending tasks** and the grocery list needs a top-up. Need me to do anything?",
    timestamp: "Just now",
  },
  reminder: {
    id: 0,
    role: "assistant",
    content:
      "Done! I've added a reminder for **Dad**: Car service on Friday at 10:00 AM. He'll also get a notification Thursday evening as a heads-up. 🔔",
    timestamp: "Just now",
    actions: [
      {
        type: "event",
        title: "Car Service",
        detail: "Dad · Friday · 10:00 AM",
        emoji: "🚗",
        confirmed: true,
      },
    ],
  },
  default: {
    id: 0,
    role: "assistant",
    content:
      "I understood that! Let me take care of it for you. Is there anything else you'd like me to help with — events, meals, tasks, or grocery items?",
    timestamp: "Just now",
  },
};

function getResponse(input: string): Message {
  const lower = input.toLowerCase();
  if (lower.includes("soccer") || lower.includes("event") || lower.includes("add")) {
    return { ...mockResponses.soccer, id: Date.now() };
  }
  if (lower.includes("meal") || lower.includes("dinner") || lower.includes("plan")) {
    return { ...mockResponses.meal, id: Date.now() };
  }
  if (lower.includes("trash") || lower.includes("chore") || lower.includes("assign")) {
    return { ...mockResponses.chore, id: Date.now() };
  }
  if (lower.includes("grocery") || lower.includes("shop") || lower.includes("list")) {
    return { ...mockResponses.grocery, id: Date.now() };
  }
  if (lower.includes("week") || lower.includes("going on") || lower.includes("update")) {
    return { ...mockResponses.week, id: Date.now() };
  }
  if (lower.includes("remind") || lower.includes("reminder")) {
    return { ...mockResponses.reminder, id: Date.now() };
  }
  return { ...mockResponses.default, id: Date.now() };
}

const actionColors: Record<string, string> = {
  event: "border-violet-500/25 bg-violet-500/8",
  meal: "border-amber-500/25 bg-amber-500/8",
  task: "border-cyan-500/25 bg-cyan-500/8",
  grocery: "border-nori-500/25 bg-nori-500/8",
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

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // Fetch initial chat logs from PocketBase and subscribe to real-time additions
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await pb.collection("chat_history").getFullList({ sort: "created" });
        if (history.length > 0) {
          setMessages(history.map((h: any) => ({
            id: h.id,
            role: h.role,
            content: h.content,
            timestamp: h.timestamp || "Just now",
            actions: h.actions || []
          })));
          setShowSuggestions(false);
        } else {
          setMessages(initialMessages);
        }
      } catch (e) {
        const saved = sessionStorage.getItem("chat_history_fallback");
        if (saved) {
          setMessages(JSON.parse(saved));
          setShowSuggestions(false);
        } else {
          setMessages(initialMessages);
        }
      }
    };

    fetchHistory();

    // Save to sessionStorage whenever messages change
    pb.collection("chat_history").subscribe("*", (e) => {
      if (e.action === "create") {
        const newMsg: Message = {
          id: e.record.id,
          role: e.record.role as "user" | "assistant",
          content: e.record.content,
          timestamp: e.record.timestamp || "Just now",
          actions: e.record.actions || []
        };
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        setShowSuggestions(false);
      } else if (e.action === "delete") {
        setMessages(initialMessages);
        setShowSuggestions(true);
      }
    });

    return () => {
      pb.collection("chat_history").unsubscribe("*");
    };
  }, []);

  const clearChat = async () => {
    try {
      const list = await pb.collection("chat_history").getFullList();
      await Promise.all(list.map(item => pb.collection("chat_history").delete(item.id)));
    } catch (e) {
      console.warn("Failed to clear database history:", e);
    }
    setMessages(initialMessages);
    sessionStorage.removeItem("chat_history_fallback");
    setShowSuggestions(true);
  };

  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem("chat_history_fallback", JSON.stringify(messages));
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = "en-US";

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const msgCounter = useRef(100);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    // 1. Create User message in PocketBase so it is persisted in the database history
    let userRecord: any = null;
    const clientTimestamp = new Date().toLocaleTimeString("en-US", { timeZone: "America/Detroit", hour: '2-digit', minute: '2-digit' });
    try {
      userRecord = await pb.collection("chat_history").create({
        role: "user",
        content: text.trim(),
        timestamp: clientTimestamp,
        sessionId: "default-session"
      });
    } catch (e) {
      console.warn("⚠️ Failed to write user message to PocketBase history:", e);
    }

    const localUserMsg: Message = {
      id: userRecord?.id || String(Date.now()),
      role: "user",
      content: text.trim(),
      timestamp: clientTimestamp,
    };

    const updatedHistory = [...messages, localUserMsg];
    setMessages(updatedHistory);
    setInput("");
    setIsTyping(true);
    setShowSuggestions(false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          history: updatedHistory.map(m => ({ role: m.role, content: m.content }))
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // The backend API route now writes the AI's reply to the chat_history collection.
      // PocketBase subscriptions will catch and render the AI message in real-time.
      // We also handle JSON mapping here just in case.
      const data = await res.json() as { reply: string; actions?: any[] };
      
      // Update locally immediately to ensure instant response if subscription has any lag
      const assistantMsg: Message = {
        id: String(Date.now() + 1),
        role: "assistant",
        content: data.reply,
        timestamp: new Date().toLocaleTimeString("en-US", { timeZone: "America/Detroit", hour: '2-digit', minute: '2-digit' }),
        actions: data.actions
      };
      setMessages((prev) => {
        if (prev.some((m) => m.content === assistantMsg.content && m.role === "assistant")) return prev;
        return [...prev, assistantMsg];
      });
    } catch (err: any) {
      console.error("❌ Failed to send chat message:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 2),
          role: "assistant",
          content: `⚠️ Sorry, I ran into an error connecting to my AI brain: ${err.message}`,
          timestamp: "Just now"
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="min-h-screen bg-surface-0 max-w-lg mx-auto flex flex-col">
      {/* Top bar */}
      <div
        className="sticky top-0 z-40 px-4 py-3 flex items-center gap-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
          background: "rgba(15,17,23,0.92)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-nori-500/10 consuela-glow border border-nori-500/20">
          <Icon3D variant="chat" size="sm" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-text-primary">Consuela</h1>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-nori-400 animate-pulse" />
            <span className="text-xs text-text-secondary">AI Family Assistant</span>
          </div>
        </div>
        
        {/* Clear chat button */}
        <button
          onClick={clearChat}
          title="Clear Chat History"
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 text-text-secondary hover:text-red-400 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
            <path d="M3 6h18" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="10" y1="11" x2="10" y2="17" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="14" y1="11" x2="14" y2="17" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-xl bg-nori-500/15 flex items-center justify-center text-sm shrink-0 mt-0.5">
                ✨
              </div>
            )}
            {msg.role === "user" && (
              <Avatar name="Mom" color="green" emoji="👩" size="sm" variant="emoji" />
            )}
            <div className={`max-w-[82%] space-y-2 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-nori-600 text-white rounded-tr-sm"
                    : "glass text-text-primary rounded-tl-sm"
                }`}
              >
                {renderContent(msg.content)}
              </div>

              {/* Action cards */}
              {msg.actions?.map((action, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-3 py-2.5 flex items-center gap-2.5 border w-full max-w-xs ${actionColors[action.type]}`}
                >
                  <span className="text-xl shrink-0">{action.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">{action.title}</p>
                    <p className="text-[11px] text-text-secondary truncate">{action.detail}</p>
                  </div>
                  {action.confirmed && (
                    <div className="w-5 h-5 rounded-full bg-nori-500 flex items-center justify-center shrink-0">
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

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-nori-500/15 flex items-center justify-center text-sm shrink-0">
              ✨
            </div>
            <div className="glass rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-nori-400"
                  style={{
                    animation: `bounce 1s ease-in-out ${i * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Suggestions */}
        {showSuggestions && messages.length <= 1 && (
          <div className="pt-2">
            <p className="text-text-muted text-xs mb-3 text-center">Try asking…</p>
            <div className="grid grid-cols-2 gap-2">
              {suggestedPrompts.map((s) => (
                <button
                  key={s.label}
                  onClick={() => sendMessage(s.prompt)}
                  className="glass rounded-xl px-3 py-2.5 text-left text-xs text-text-secondary hover:text-text-primary hover:border-nori-500/30 transition-all active:scale-95"
                  style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="sticky bottom-0 px-4 pb-24 pt-3"
        style={{
          background: "linear-gradient(to top, rgba(15,17,23,1) 70%, rgba(15,17,23,0))",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 5.5rem)",
        }}
      >
        <div
          className="flex items-end gap-2 rounded-2xl glass px-3 py-2"
          style={{ border: "1px solid rgba(59,130,246,0.15)" }}
        >
          {/* Voice button */}
          <button
            onClick={toggleListening}
            className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors shrink-0 mb-0.5 ${
              isListening ? "text-red-400 bg-red-500/10" : "text-text-secondary hover:text-nori-400"
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
            placeholder="Message Consuela…"
            rows={1}
            className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-muted resize-none outline-none leading-relaxed py-1.5 max-h-28"
            style={{ minHeight: "36px" }}
          />

          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            className={`w-9 h-9 flex items-center justify-center rounded-xl shrink-0 mb-0.5 transition-all ${
              input.trim()
                ? "bg-nori-500 text-white hover:bg-nori-400 active:scale-95"
                : "bg-surface-3 text-text-muted cursor-not-allowed"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
              <path d="M22 2L11 13" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Context pills */}
        <div className="flex gap-2 mt-2.5 overflow-x-auto pb-0.5">
          <Badge variant="gray">📅 Calendar</Badge>
          <Badge variant="gray">🍽️ Meals</Badge>
          <Badge variant="gray">✅ Tasks</Badge>
          <Badge variant="gray">🛒 Grocery</Badge>
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
