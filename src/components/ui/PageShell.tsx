import type { CSSProperties, ReactNode } from "react";
import BottomNav from "./BottomNav";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export default function PageShell({ children, className = "", style }: PageShellProps) {
  return (
    <div className={`min-h-screen bg-[var(--color-canvas)] max-w-lg md:max-w-3xl mx-auto relative overflow-hidden ${className}`} style={style}>
      <main className="relative z-10 pb-32">{children}</main>
      <BottomNav />
    </div>
  );
}
