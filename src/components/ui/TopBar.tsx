import Link from "next/link";

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
          background: "linear-gradient(to bottom, rgba(15,17,23,0.95) 80%, rgba(15,17,23,0))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {back && (
          <Link
            href="/"
            className="flex items-center justify-center w-10 h-10 rounded-2xl bg-surface-2/50 border border-white/5 text-text-secondary hover:text-nori-400 hover:border-nori-500/30 transition-all active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
        <div className="flex-1 min-w-0">
          {title && (
            <h1 className="text-lg font-bold text-text-primary truncate leading-tight tracking-tight">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-[11px] font-medium text-nori-400/80 uppercase tracking-widest truncate leading-tight mt-0.5">{subtitle}</p>
          )}
        </div>
        {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
      </div>
    </div>
  );
}
