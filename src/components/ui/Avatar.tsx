interface AvatarProps {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  emoji?: string;
}

const colorMap: Record<string, string> = {
  green: "bg-nori-600 text-nori-100",
  violet: "bg-accent-violet/20 text-accent-violet",
  amber: "bg-amber-600/20 text-amber-400",
  cyan: "bg-cyan-600/20 text-cyan-400",
  rose: "bg-rose-600/20 text-rose-400",
  blue: "bg-blue-600/20 text-blue-400",
};

const sizeMap = {
  sm: "w-7 h-7 text-xs",
  md: "w-9 h-9 text-sm",
  lg: "w-12 h-12 text-base",
};

export default function Avatar({ name, color = "green", size = "md", emoji }: AvatarProps) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold shrink-0 ${colorMap[color] ?? colorMap.green} ${sizeMap[size]}`}
    >
      {emoji ?? initials}
    </div>
  );
}
