"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import SyncInit from "./SyncInit";

const itemColors: Record<string, { gradient: string; shadow: string; glassBg: string }> = {
  "/": {
    gradient: "radial-gradient(circle at 30% 30%, var(--color-accent-nori), var(--color-accent-button))",
    shadow: "var(--color-accent-glow)",
    glassBg: "linear-gradient(135deg, var(--color-accent-selected), var(--color-accent-button))",
  },
  "/chat": {
    gradient: "radial-gradient(circle at 30% 30%, var(--color-accent-lavender), var(--color-accent-violet))",
    shadow: "rgba(167,139,250,0.35)",
    glassBg: "linear-gradient(135deg, var(--color-accent-lavender), var(--color-accent-violet))",
  },
  "/meals": {
    gradient: "radial-gradient(circle at 30% 30%, var(--color-accent-sage), var(--color-accent-mint))",
    shadow: "rgba(132,204,22,0.35)",
    glassBg: "linear-gradient(135deg, var(--color-accent-sage), var(--color-accent-mint))",
  },
  "/tasks": {
    gradient: "radial-gradient(circle at 30% 30%, var(--color-accent-apricot), var(--color-accent-amber))",
    shadow: "rgba(251,146,60,0.35)",
    glassBg: "linear-gradient(135deg, var(--color-accent-apricot), var(--color-accent-amber))",
  },
  "/settings": {
    gradient: "radial-gradient(circle at 30% 30%, var(--color-surface-5), var(--color-surface-3))",
    shadow: "rgba(148,163,184,0.35)",
    glassBg: "linear-gradient(135deg, var(--color-surface-5), var(--color-surface-3))",
  },
  "/more": {
    gradient: "radial-gradient(circle at 30% 30%, var(--color-surface-5), var(--color-surface-3))",
    shadow: "rgba(148,163,184,0.35)",
    glassBg: "linear-gradient(135deg, var(--color-surface-5), var(--color-surface-3))",
  },
};

const navItems = [
  {
    href: "/",
    label: "Home",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Ask",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a8 8 0 0 0-8 8c0 1.6.5 3.1 1.3 4.4L4 21l5.6-1.3A8 8 0 1 0 12 3Z" />
        <circle cx="8.5" cy="11" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="11" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/meals",
    label: "Meals",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 3v8a4 4 0 0 0 4 4v6" />
        <path d="M8 3v8" />
        <path d="M8 15v6" />
        <path d="M17 3c-2 0-3 2-3 5s1 5 3 5v8" />
      </svg>
    ),
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1.5l.8 3.3a8.5 8.5 0 0 1 1.9.8l3.1-1.7 1.4 1.4-1.7 3.1a8.5 8.5 0 0 1 .8 1.9l3.3.8v1.8l-3.3.8a8.5 8.5 0 0 1-.8 1.9l1.7 3.1-1.4 1.4-3.1-1.7a8.5 8.5 0 0 1-1.9.8L12 22.5h-1l-.8-3.3a8.5 8.5 0 0 1-1.9-.8l-3.1 1.7-1.4-1.4 1.7-3.1a8.5 8.5 0 0 1-.8-1.9L1.5 12v-1l3.3-.8a8.5 8.5 0 0 1 .8-1.9l-1.7-3.1 1.4-1.4 3.1 1.7a8.5 8.5 0 0 1 1.9-.8L11 1.5z" />
      </svg>
    ),
  },
  {
    href: "/more",
    label: "More",
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="12" r="1.5" fill="currentColor" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        <circle cx="18" cy="12" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  const [isLight, setIsLight] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkTheme = () => setIsLight(document.documentElement.getAttribute("data-theme") === "light");
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const activeColor = itemColors[pathname] || itemColors["/"];
  const barBg = isLight ? "rgba(0, 0, 0, 0.16)" : "rgba(0, 0, 0, 0.34)";
  const barBorder = isLight ? "1px solid rgba(0, 0, 0, 0.08)" : "1px solid rgba(255, 255, 255, 0.12)";
  const barShadow = isLight ? "0 10px 30px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.55)" : "0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.10)";
  const inactiveBg = isLight ? "rgba(255, 255, 255, 0.10)" : "rgba(255, 255, 255, 0.05)";
  const inactiveBorder = isLight ? "1px solid rgba(0, 0, 0, 0.05)" : "1px solid rgba(255, 255, 255, 0.06)";

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-lg mx-auto pb-safe">
        <div className="mx-4 mb-3 relative">
          <div
            ref={barRef}
            className="relative grid grid-cols-6 items-center gap-0 rounded-[2.5rem] px-2 py-4 backdrop-blur-sm"
            style={{
              background: barBg,
              border: barBorder,
              boxShadow: barShadow,
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
            }}
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link key={item.href} href={item.href} aria-label={item.label} className="group relative flex justify-center outline-none">
                  <button
                    type="button"
                    tabIndex={-1}
                    className="relative z-10 grid h-14 w-14 place-items-center rounded-full outline-none tap"
                  >
                    {!isActive && (
                      <span
                        className="absolute inset-0 rounded-full"
                        style={{ background: inactiveBg, border: inactiveBorder, boxShadow: "inset 0 1px 2px rgba(0,0,0,0.10)" }}
                      />
                    )}

                    {isActive && (
                      <>
                        <span className="pointer-events-none absolute -inset-[10px] rounded-full" style={{ background: `radial-gradient(circle, ${activeColor.shadow} 0%, transparent 70%)`, filter: "blur(14px)", opacity: 0.72 }} />
                        <span className="pointer-events-none absolute -inset-[4px] rounded-full" style={{ background: "conic-gradient(from 0deg, #ff5fa2, #ff8a5b, #ffd76b, #7df9c8, #5ab6ff, #a07cff, #ff5fa2)", filter: "drop-shadow(0 0 8px rgba(255,255,255,0.18))" }} />
                        <span className="absolute -inset-[2px] rounded-full" style={{ background: activeColor.glassBg, border: "1px solid rgba(255,255,255,0.28)", boxShadow: `inset 0 1px 0 rgba(255,255,255,0.28), 0 10px 20px ${activeColor.shadow}` }} />
                      </>
                    )}

                    <span className={`relative z-10 grid h-6 w-6 place-items-center transition-all duration-300 ${isActive ? "text-white drop-shadow-md -translate-y-[2px]" : "text-white/80 group-hover:text-white"}`}>
                      {item.icon(isActive)}
                    </span>
                  </button>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <SyncInit />
    </nav>
  );
}
