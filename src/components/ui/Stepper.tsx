"use client";

interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  label?: string;
  className?: string;
}

export default function Stepper({ value, min = 0, max = 99, onChange, label, className = "" }: StepperProps) {
  const decrement = () => onChange(Math.max(min, value - 1));
  const increment = () => onChange(Math.min(max, value + 1));

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && <span className="text-xs font-semibold text-text-secondary">{label}</span>}
      <button type="button" onClick={decrement} disabled={value <= min} className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--color-surface-2)] text-text-primary tap-sm disabled:opacity-40">−</button>
      <span className="min-w-8 text-center text-sm font-semibold text-text-primary display-numeral">{value}</span>
      <button type="button" onClick={increment} disabled={value >= max} className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--color-surface-2)] text-text-primary tap-sm disabled:opacity-40">+</button>
    </div>
  );
}
