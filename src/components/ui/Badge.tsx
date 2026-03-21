interface BadgeProps {
  children: React.ReactNode;
  variant?: "green" | "amber" | "rose" | "violet" | "cyan" | "gray";
}

const variantMap = {
  green: "bg-nori-500/15 text-nori-400 border-nori-500/20",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  rose: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  violet: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  gray: "bg-surface-3 text-text-secondary border-surface-4",
};

export default function Badge({ children, variant = "gray" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${variantMap[variant]}`}
    >
      {children}
    </span>
  );
}
