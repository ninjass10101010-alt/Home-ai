interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  glow?: boolean;
}

export default function Card({ children, className = "", onClick, glow }: CardProps) {
  const base =
    "rounded-2xl glass p-4 transition-all duration-300 will-change-transform";
  const interactive = onClick
    ? "cursor-pointer hover:border-nori-500/20 active:scale-[0.98]"
    : "";
  const glowClass = glow ? "consuela-glow border-nori-500/20" : "";
  const transformClass = "isometric-card";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${interactive} ${glowClass} ${transformClass} ${className} w-full text-left`}
      >
        {children}
      </button>
    );
  }

  return (
    <div className={`${base} ${glowClass} ${transformClass} ${className}`}>
      {children}
    </div>
  );
}