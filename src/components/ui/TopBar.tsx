import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";

interface TopBarProps {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  back?: boolean;
  variant?: "default" | "emergency";
}

export default function TopBar({ title, subtitle, right, back, variant = "default" }: TopBarProps) {
  const { colors, accentRgb } = useAtmosphericTheme();

  const isEmergency = variant === "emergency";

  const getAccentColorStyle = () => {
    return {
      background: isEmergency ? "rgba(244,63,94,0.18)" : `rgba(${accentRgb},0.10)`,
      color: isEmergency ? "rgb(251,113,133)" : colors.accentColor,
    };
  };

  const boxStyle = isEmergency
    ? {
        background: "rgba(244,63,94,0.12)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 0 32px rgba(244,63,94,0.35), 0 0 64px rgba(244,63,94,0.15)",
        borderColor: "rgba(244,63,94,0.3)",
      }
    : {
        background: `rgba(${accentRgb},0.08)`,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: `0 0 24px ${colors.glow}`,
      };

  return (
    <div className="sticky top-0 z-40 w-full" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div
        className={`mx-3 px-4 py-3 flex items-center gap-3 glass isometric-card rounded-2xl${isEmergency ? " border-2" : ""}`}
        style={{
          ...boxStyle,
          ...(isEmergency ? { borderStyle: "solid" } : {}),
        }}
      >
        {back && (
          <Link
            href="/"
            className="flex items-center justify-center w-9 h-9 rounded-2xl text-text-secondary hover:text-text-primary tap-sm"
            style={getAccentColorStyle()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
        <div className="flex-1 min-w-0">
          {title && (
            <h1 className={`text-base font-semibold truncate leading-tight ${isEmergency ? "text-rose-400" : "text-text-primary"}`}>
              {title}
            </h1>
          )}
          {subtitle && (
            <p className={`text-xs truncate leading-tight ${isEmergency ? "text-rose-300/70" : "text-text-secondary"}`}>{subtitle}</p>
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
