interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  glow?: boolean;
  variant?: "standard" | "strong" | "subtle";
  style?: React.CSSProperties;
}

export default function Card({ 
  children, 
  className = "", 
  onClick, 
  glow, 
  variant = "standard",
  style
}: CardProps) {
  
  // Base styles for all card variants
  const baseStyles = `
    rounded-2xl p-4 transition-all duration-300 will-change-transform
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)] focus-visible:ring-offset-2
  `;

  // Glass variant styles using CSS variables
  const variantStyles: Record<string, string> = {
    standard: `
      bg-[var(--color-surface-0)]/50
      backdrop-blur
      border-[1px] border-[var(--color-surface-0)]/20
      box-shadow-[0_8px_32px_rgba(0,0,0,0.08)]
    `,
    strong: `
      bg-[var(--color-surface-0)]/75
      backdrop-blur
      border-[1px] border-[var(--color-surface-0)]/40
      box-shadow-[0_8px_32px_rgba(0,0,0,0.12)]
    `,
    subtle: `
      bg-[var(--color-surface-0)]/35
      backdrop-blur-sm
      border-[1px] border-[var(--color-surface-0)]/10
      box-shadow-[0_4px_16px_rgba(0,0,0,0.06)]
    `,
  };

  // Interactive states (for clickable cards)
  const interactiveStyles = onClick
    ? `
      cursor-pointer
      hover:border-[var(--color-surface-0)]/40
      active:scale-[0.98]
      hover:box-shadow-[0_12px_48px_rgba(0,0,0,0.15)]
    `
    : "";

  // Glow effect
  const glowClass = glow ? "consuela-glow" : "";

  // Isometric transform
  const transformClass = "isometric-card";

  // Base class combining all styles
  const baseClass = `
    ${baseStyles}
    ${variantStyles[variant]}
    ${interactiveStyles}
    ${glowClass}
    ${transformClass}
  `;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} ${className} w-full text-left`}
        style={style}
      >
        {children}
      </button>
    );
  }

  return (
    <div className={`${baseClass} ${className}`} style={style}>
      {children}
    </div>
  );
}