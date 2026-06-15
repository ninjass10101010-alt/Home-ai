"use client";

import SoftButton from "./SoftButton";

interface ErrorStateProps {
  title?: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export default function ErrorState({ title = "Something needs attention", description = "Consuela could not load this section. Try again or continue from another tab.", retryLabel = "Try again", onRetry }: ErrorStateProps) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-rose-300/20 bg-rose-500/10 p-8 text-center backdrop-blur-xl">
      <div className="mb-4 text-4xl">⚠️</div>
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-text-secondary">{description}</p>
      {onRetry && (
        <SoftButton onClick={onRetry} variant="danger" className="mt-5">
          {retryLabel}
        </SoftButton>
      )}
    </div>
  );
}
