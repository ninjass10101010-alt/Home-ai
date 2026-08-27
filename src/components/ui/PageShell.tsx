"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import CapsuleNav from "./CapsuleNav";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export default function PageShell({ children, className = "", style }: PageShellProps) {
  const pathname = usePathname();

  return (
    <div className={`min-h-screen bg-[var(--color-canvas)] max-w-lg md:max-w-3xl lg:max-w-none mx-auto relative overflow-hidden ${className}`} style={style}>
      <main key={pathname} className="page-settle relative z-10 pb-32">{children}</main>
      <CapsuleNav />
    </div>
  );
}
