import { useTheme } from "@/hooks/useTheme";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "accent" | "outline" | "status";
  statusVariant?: "success" | "pending" | "urgent";
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function Badge({ 
  children, 
  variant = "default", 
  statusVariant, 
  size = "md", 
  className = "" 
}: BadgeProps) {
  const { theme } = useTheme();
  
  // Size configurations
  const sizeMap: Record<string, string> = {
    sm: "px-1.5 py-0.375 text-[0.75rem]",
    md: "px-2.5 py-0.5 text-[0.875rem]",
    lg: "px-3 py-0.625 text-[1rem]",
  };

  // Base styles
  const baseStyles = `
    inline-flex items-center
    rounded-full
    font-medium
    transition-all duration-200
    focus-visible:outline-none
    focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)] focus-visible:ring-offset-2
  `;

  // Variant styles using CSS variables
  const variantStyles: Record<string, string> = {
    default: `
      bg-[var(--color-surface-3)]
      text-[var(--color-text-secondary)]
      border-none
    `,
    accent: `
      bg-[var(--color-accent-selected)]
      text-[var(--color-text-on-accent)]
      border-none
    `,
    outline: `
      bg-transparent
      border-[1px] border-[var(--color-accent-selected)]
      text-[var(--color-accent-selected)]
    `,
    status: `
      bg-transparent
      border-none
      text-[var(--color-text-on-accent)]
    `,
  };

  // Status-specific background colors
  const statusBgStyles: Record<string, string> = {
    success: `
      bg-[var(--color-accent-mint)]
    `,
    pending: `
      bg-[var(--color-accent-amber)]
    `,
    urgent: `
      bg-[var(--color-accent-rose)]
    `,
  };

  // Combine status variant with base variant if status is specified
  const finalVariantStyles = statusVariant && variant === "status"
    ? `${variantStyles.status} ${statusBgStyles[statusVariant]}`
    : variantStyles[variant];

  return (
    <span
      className={`${baseStyles} ${sizeMap[size]} ${finalVariantStyles} ${className}`}
    >
      {children}
    </span>
  );
}