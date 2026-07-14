"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConsuelaFAB from "./ConsuelaFAB";


const navItems = [
  {
    href: "/",
    label: "Home",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Ask Consuela",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3a8 8 0 0 0-8 8c0 1.6.5 3.1 1.3 4.4L4 21l5.6-1.3A8 8 0 1 0 12 3Z" />
        <circle cx="8.5" cy="11" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="11" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    primary: true,
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/meals",
    label: "Meals",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
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
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    ),
  },
  {
    href: "/emergency",
    label: "Emergency",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Z" />
        <path d="M12 8v5M12 16h.01" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-lg mx-auto pb-safe"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="mx-4 mb-3 relative">
          {/* Outer rim glow — fades at top/bottom */}
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 40%, rgba(255,255,255,0) 60%, rgba(255,255,255,0.06))",
              maskImage:
                "linear-gradient(180deg, transparent 0%, black 20%, black 80%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(180deg, transparent 0%, black 20%, black 80%, transparent 100%)",
            }}
          />

          {/* Bar background — clear glass with visible rim */}
          <div
            className="relative flex items-center justify-around gap-2 rounded-full border border-white/15 px-3 py-3 backdrop-blur-2xl"
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
              boxShadow:
                "0 1px 0 0 rgba(255,255,255,0.08) inset, 0 -1px 0 0 rgba(0,0,0,0.4) inset, 0 20px 60px -20px rgba(0,0,0,0.6), 0 8px 24px -8px rgba(0,0,0,0.5)",
            }}
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className="group relative flex flex-col items-center gap-0.5 outline-none"
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className="relative grid h-12 w-12 place-items-center rounded-full outline-none transition-transform duration-300 hover:scale-105"
                  >
                    {/* Active rainbow gradient rim (conic) */}
                    {isActive && (
                      <>
                        <span
                          className="pointer-events-none absolute -inset-[2px] rounded-full"
                          style={{
                            background:
                              "conic-gradient(from 0deg, #ff5fa2, #ff8a5b, #ffd76b, #7df9c8, #5ab6ff, #a07cff, #ff5fa2)",
                            filter: "blur(0.5px)",
                          }}
                        />
                        <span
                          className="pointer-events-none absolute inset-0 rounded-full"
                          style={{
                            background:
                              "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))",
                          }}
                        />
                      </>
                    )}

                    {/* Frosted inner disc */}
                    <span
                      className={`absolute inset-[2px] rounded-full backdrop-blur-xl transition-colors duration-300 ${
                        isActive ? "" : "bg-white/[0.04]"
                      }`}
                      style={
                        isActive
                          ? {
                              background:
                                "radial-gradient(120% 120% at 30% 20%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.02))",
                            }
                          : undefined
                      }
                    />

                    {/* Inner rim line */}
                    <span
                      className="pointer-events-none absolute inset-[2px] rounded-full"
                      style={{
                        boxShadow: isActive
                          ? "0 0 0 1px rgba(255,255,255,0.18) inset, 0 0 18px rgba(160,124,255,0.25)"
                          : "0 0 0 1px rgba(255,255,255,0.10) inset",
                      }}
                    />

                    {/* Icon */}
                    <span
                      className={`relative z-10 grid h-5 w-5 place-items-center transition-colors duration-300 ${
                        isActive
                          ? "text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.6)]"
                          : "text-white/80 group-hover:text-white"
                      }`}
                    >
                      {item.icon(isActive)}
                    </span>
                  </button>

                  {/* Label — always visible below */}
                  <span
                    className={`text-[10px] font-medium tracking-wide transition-colors duration-200 ${
                      isActive ? "text-white" : "text-white/50"
                    }`}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <ConsuelaFAB />
    </nav>
  );
}
