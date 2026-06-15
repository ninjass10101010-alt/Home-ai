"use client";

import type { ReactNode } from "react";
import Surface from "@/components/ui/Surface";

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export default function SectionCard({ title, description, icon, children, footer, className = "" }: SectionCardProps) {
  return (
    <Surface variant="warm" radius="2xl" padding="none" className={`overflow-visible ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
        <div className="flex items-center gap-3">
          {icon && <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--color-accent-selected)]/15 text-xl">{icon}</span>}
          <div>
            <h3 className="text-base font-bold text-text-primary">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-text-secondary">{description}</p>}
          </div>
        </div>
      </div>
      <div className="p-5">{children}</div>
      {footer && <div className="border-t border-white/10 p-4">{footer}</div>}
    </Surface>
  );
}
