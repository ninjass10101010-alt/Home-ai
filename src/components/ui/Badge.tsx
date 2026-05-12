interface BadgeProps {
  children: React.ReactNode;
  variant?: "green" | "amber" | "rose" | "violet" | "cyan" | "gray";
  glass?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const variantMap = {
  green: "bg-nori-500/15 text-nori-400 border-nori-500/20",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  rose: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  violet: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  gray: "bg-surface-3 text-text-secondary border-surface-4",
};

export default function Badge({ children, variant = "gray", glass, size = "md" }: BadgeProps) {
  const sizeClass = size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]";
  const glassClass = glass ? "glass backdrop-blur-xl" : "";
  return (
    <span
      className={`inline-flex items-center ${sizeClass} rounded-full font-medium border ${variantMap[variant]} ${glassClass}`}
    >
      {children}
    </span>
  );
}