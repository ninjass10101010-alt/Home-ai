"use client";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: React.ReactNode;
}

const variantMap = {
  primary:
    "bg-[var(--color-accent-selected)] text-white hover:brightness-110 active:brightness-90 font-semibold shadow-lg",
  secondary:
    "bg-surface-3 text-text-primary hover:bg-surface-4 active:bg-surface-2 border border-surface-4",
  ghost:
    "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-2",
  danger:
    "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 border border-rose-500/20",
};

const sizeMap = {
  sm: "px-3 py-1.5 text-xs rounded-xl gap-1.5",
  md: "px-4 py-2.5 text-sm rounded-xl gap-2",
  lg: "px-6 py-3.5 text-base rounded-2xl gap-2.5",
};

export default function Button({
  variant = "primary",
  size = "md",
  loading,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled ?? loading}
      className={`inline-flex items-center justify-center transition-all duration-150 ${variantMap[variant]} ${sizeMap[size]} ${
        disabled || loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${className}`}
    >
      {loading && (
        <svg
          className="animate-spin w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
