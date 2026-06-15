"use client";

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export default function Toggle({ checked, onCheckedChange, label, description, disabled = false, className = "" }: ToggleProps) {
  return (
    <label className={`flex items-center justify-between gap-4 ${className}`}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-semibold text-text-primary">{label}</span>}
          {description && <span className="block text-xs text-text-muted mt-0.5">{description}</span>}
        </span>
      )}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="sr-only peer"
        aria-label={label}
      />
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-selected)] peer-focus-visible:ring-offset-2 ${
          checked ? "bg-[var(--color-accent-selected)] border-[var(--color-accent-selected)]" : "bg-[var(--color-surface-3)] border-white/10"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </span>
    </label>
  );
}
