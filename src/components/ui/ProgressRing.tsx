"use client";

interface ProgressRingProps {
  value: number;
  max: number;
  label: string;
  detail?: string;
  size?: number;
  stroke?: number;
}

export default function ProgressRing({ value, max, label, detail, size = 132, stroke = 10 }: ProgressRingProps) {
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const progress = max > 0 ? Math.max(0, Math.min(value / max, 1)) : 0;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-surface-3)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-accent-selected)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-300"
          />
        </svg>
      </div>
      <div className="min-w-0">
        <div className="text-lg font-bold text-text-primary display-numeral">{Math.round(progress * 100)}%</div>
        <div className="mt-0.5 text-xs font-semibold text-text-primary truncate">{label}</div>
        {detail && <div className="mt-0.5 text-[10px] text-text-muted truncate">{detail}</div>}
      </div>
    </div>
  );
}
