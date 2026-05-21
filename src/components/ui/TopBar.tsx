import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

interface TopBarProps {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  back?: boolean;
}

export default function TopBar({ title, subtitle, right, back }: TopBarProps) {
  return (
    <div className="sticky top-0 z-40 w-full" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{
          background: "linear-gradient(to bottom, var(--color-surface-0) 80%, transparent)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {back && (
          <Link
            href="/"
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
        <div className="flex-1 min-w-0">
          {title && (
            <h1 className="text-base font-semibold text-text-primary truncate leading-tight">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-xs text-text-secondary truncate leading-tight">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {right && <div>{right}</div>}
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
