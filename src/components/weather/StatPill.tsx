/**
 * StatPill — Compact stat display for weather widget expanded view.
 */
"use client";

export default function StatPill({ icon, label, value, delay, accentColor }: {
  icon: string; label: string; value: string; delay: string; accentColor: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-2.5 px-1 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(8px)", animation: `weatherForecastIn 0.35s ease-out ${delay} both` }}>
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-xs font-bold" style={{ color: accentColor }}>{value}</span>
      <span className="text-text-muted text-[10px]">{label}</span>
    </div>
  );
}
