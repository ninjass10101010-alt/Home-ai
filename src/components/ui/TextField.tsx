"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: ReactNode;
  errorText?: ReactNode;
}

export default function TextField({ label, helperText, errorText, className = "", ...props }: TextFieldProps) {
  const generatedId = useId();
  const id = props.id || `text-field-${generatedId}`;

  return (
    <label className="block" htmlFor={id}>
      {label && <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">{label}</span>}
      <input
        id={id}
        className={`w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none transition-all duration-150 placeholder:text-text-muted focus:border-[var(--color-accent-selected)]/50 focus:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] ${errorText ? "border-rose-400/50" : ""} ${className}`}
        {...props}
      />
      {(helperText || errorText) && (
        <span className={`mt-1 block text-xs ${errorText ? "text-rose-300" : "text-text-muted"}`}>
          {errorText || helperText}
        </span>
      )}
    </label>
  );
}
