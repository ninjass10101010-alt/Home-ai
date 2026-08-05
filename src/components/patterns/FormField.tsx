"use client";

import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  children: ReactNode;
  helperText?: ReactNode;
  errorText?: ReactNode;
  className?: string;
}

export default function FormField({ label, children, helperText, errorText, className = "" }: FormFieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">{label}</span>
      {children}
      {(helperText || errorText) && (
        <span className={`mt-1 block text-xs ${errorText ? "text-rose-300" : "text-text-muted"}`}>
          {errorText || helperText}
        </span>
      )}
    </label>
  );
}
