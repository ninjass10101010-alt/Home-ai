"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConsuelaFAB from "./ConsuelaFAB";
import SyncInit from "./SyncInit";

const navItems = [
  {
    href: "/",
    label: "Home",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.5 : 1.8}
        className="w-6 h-6"
      >
        <path
          d="M3 12L12 3l9 9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9 21V12h6v9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5 10v11h14V10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Ask Consuela",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={active ? 0 : 1.8}
        className="w-6 h-6"
      >
        <path
          d="M12 2C6.48 2 2 6.03 2 11c0 2.7 1.2 5.1 3.1 6.8L4 22l4.4-1.5C9.5 20.8 10.7 21 12 21c5.52 0 10-4.03 10-9s-4.48-9-10-9z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="8.5" cy="11" r="1" fill="currentColor" className={active ? "fill-[var(--color-accent-selected)]" : "fill-current"} stroke="none" />
        <circle cx="12" cy="11" r="1" fill="currentColor" className={active ? "fill-[var(--color-accent-selected)]" : "fill-current"} stroke="none" />
        <circle cx="15.5" cy="11" r="1" fill="currentColor" className={active ? "fill-[var(--color-accent-selected)]" : "fill-current"} stroke="none" />
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
        strokeWidth={active ? 2.5 : 1.8}
        className="w-6 h-6"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="15" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="15" r="1" fill="currentColor" stroke="none" />
        <circle cx="16" cy="15" r="1" fill="currentColor" stroke="none" />
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
        strokeWidth={active ? 2.5 : 1.8}
        className="w-6 h-6"
      >
        <path d="M18 8h1a4 4 0 010 8h-1" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 1v3M10 1v3M14 1v3" strokeLinecap="round" strokeLinejoin="round" />
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
        strokeWidth={active ? 2.5 : 1.8}
        className="w-6 h-6"
      >
        <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/grocery",
    label: "Grocery",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 2.5 : 1.8}
        className="w-6 h-6"
      >
        <circle cx="9" cy="21" r="1" fill="currentColor" stroke="none" />
        <circle cx="20" cy="21" r="1" fill="currentColor" stroke="none" />
        <path d="M1 1h4l2.5 13h11l3-7H6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/emergency",
    label: "Emergency",
    icon: (active: boolean) => (
      <svg
        viewBox="0 0 24 24"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={active ? 0 : 1.8}
        className="w-6 h-6"
      >
        <path d="M12 2L4 7v6c0 5 3.5 9.7 8 11 4.5-1.3 8-6 8-11V7l-8-5z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 8v4M12 16h.01" strokeLinecap="round" strokeLinejoin="round" />
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
        strokeWidth={active ? 2.5 : 1.8}
        className="w-6 h-6"
      >
        <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 2v2M12 20v2M20 12h-2M6 12H4M17.66 6.34l-1.41 1.41M8.76 16.24l-1.41 1.41M17.66 17.66l-1.41-1.41M8.76 7.76l-1.41-1.41" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-lg mx-auto"
        style={{
          background: "linear-gradient(to top, var(--color-surface-0) 60%, transparent)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          className="mx-4 mb-3 flex items-center justify-around rounded-2xl glass px-2 py-2"
        >
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-0.5 flex-1 py-1 group"
                aria-label={item.label}
              >
                {item.primary ? (
                  <span
                    className={`flex items-center justify-center w-12 h-10 rounded-xl transition-all duration-200 ${
                      isActive
                        ? "bg-[var(--color-accent-selected)] text-[var(--color-text-on-accent)] consuela-glow"
                        : "bg-[var(--color-accent-selected)]/15 text-[var(--color-accent-selected)] group-hover:bg-[var(--color-accent-selected)]/25"
                    }`}
                  >
                    {item.icon(isActive)}
                  </span>
                ) : (
                  <span
                    className={`flex items-center justify-center w-10 h-8 rounded-lg transition-all duration-200 ${
                      isActive
                        ? "text-[var(--color-accent-selected)]"
                        : "text-text-secondary group-hover:text-text-primary"
                    }`}
                  >
                    {item.icon(isActive)}
                  </span>
                )}
                <span
                  className={`text-[10px] font-medium transition-colors duration-200 ${
                    isActive
                      ? "text-[var(--color-accent-selected)]"
                      : "text-text-muted"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      <SyncInit />
      <ConsuelaFAB />
    </nav>
  );
}
