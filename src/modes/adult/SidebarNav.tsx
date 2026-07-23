/**
 * SidebarNav — Tablet/desktop sidebar navigation for Adult Mode.
 *
 * On screens ≥ 768px, replaces the BottomNav with a persistent left sidebar.
 * This gives the Adult dashboard a proper desktop feel.
 *
 * On mobile (< 768px), this component renders nothing (BottomNav is used instead).
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/chat", label: "Ask Consuela", icon: "💬" },
  { href: "/calendar", label: "Calendar", icon: "📅" },
  { href: "/meals", label: "Meals", icon: "🍽️" },
  { href: "/tasks", label: "Tasks", icon: "✅" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside
        className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 flex-col w-60 border-r border-white/[0.06]"
        style={{
          background: "var(--color-surface-0)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        {/* Logo / brand */}
        <div className="px-5 pt-6 pb-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-2xl grid place-items-center text-base shrink-0"
              style={{
                background: "linear-gradient(135deg, var(--color-accent-selected), var(--color-accent-violet))",
                boxShadow: "0 0 16px rgba(var(--color-accent-selected-rgb, 59,130,246), 0.25)",
              }}
            >
              ✨
            </div>
            <div>
              <h2 className="text-sm font-bold text-text-primary tracking-tight">Consuela</h2>
              <p className="text-[10px] text-text-muted">Family Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${
                  isActive
                    ? "text-text-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
                }`}
                style={isActive ? {
                  background: "rgba(var(--color-accent-selected-rgb, 59,130,246), 0.12)",
                  border: "1px solid rgba(var(--color-accent-selected-rgb, 59,130,246), 0.15)",
                } : {
                  border: "1px solid transparent",
                }}
              >
                <span className="text-base w-6 text-center">{item.icon}</span>
                <span className="text-sm font-medium">{item.label}</span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--color-accent-selected)]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Emergency button */}
        <div className="px-3 pb-6 pt-2 border-t border-white/[0.06]">
          <Link
            href="/emergency"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-rose-400 hover:bg-rose-500/[0.08] transition-colors"
          >
            <span className="text-base w-6 text-center">🛡️</span>
            <span className="text-sm font-medium">Emergency</span>
          </Link>
        </div>
      </aside>

    </>
  );
}
