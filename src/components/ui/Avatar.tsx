"use client";

interface AvatarProps {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  emoji?: string;
  src?: string;
  variant?: "emoji" | "illustrated" | "image";
}

const colorMap: Record<string, string> = {
  green: "bg-nori-600 text-nori-100",
  violet: "bg-accent-violet/20 text-accent-violet",
  amber: "bg-amber-600/20 text-amber-400",
  cyan: "bg-cyan-600/20 text-cyan-400",
  rose: "bg-rose-500/20 text-rose-400",
  blue: "bg-blue-600/20 text-blue-400",
};

// Ring color mapping for emoji variant
const ringMap: Record<string, string> = {
  green: "ring-nori-500/30",
  violet: "ring-accent-violet/40",
  amber: "ring-amber-500/30",
  cyan: "ring-cyan-500/30",
  rose: "ring-rose-500/30",
  blue: "ring-blue-500/30",
};

// Avatar sizing map - typed as Record<string, string> to allow indexing
const sizeMap: Record<string, string> = {
  sm: "w-7 h-7 text-xs",
  md: "w-9 h-9 text-sm",
  lg: "w-12 h-12 text-base",
};

function FamilyIllustration({ name, colorName, size }: { name: string; colorName: string; size: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const colors: Record<string, { bg: string; text: string; light: string }> = {
    green: { bg: "bg-nori-600", text: "text-nori-50", light: "bg-nori-400/20" },
    violet: { bg: "bg-accent-violet", text: "text-violet-50", light: "bg-accent-violet/20" },
    amber: { bg: "bg-amber-500", text: "text-amber-50", light: "bg-amber-500/20" },
    cyan: { bg: "bg-accent-cyan", text: "text-cyan-50", light: "bg-accent-cyan/20" },
    rose: { bg: "bg-accent-rose", text: "text-rose-50", light: "bg-accent-rose/20" },
    blue: { bg: "bg-nori-500", text: "text-blue-50", light: "bg-nori-500/20" },
  };

  const c = colors[colorName] || colors.green;

  return (
    <div className={`${sizeMap[size] || sizeMap.md} relative flex items-center justify-center shrink-0`}>
      <div className={`absolute inset-0 rounded-full ${c.light} animate-pulse`} />
      <div className={`relative ${sizeMap[size] || sizeMap.md} rounded-full ${c.bg} flex items-center justify-center shadow-lg border border-white/20 overflow-hidden`}>
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-20">
            <svg viewBox="0 0 100 100" className="w-full h-full fill-current text-white">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
            </svg>
        </div>
        <span className={`${c.text} font-bold tracking-tight relative z-10`}>{initials}</span>
        {/* Shine effect */}
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
      </div>
    </div>
  );
}

export default function Avatar({ name, color = "green", size = "md", emoji, src, variant = "illustrated" }: AvatarProps) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  if (src || variant === "image") {
    const ringClass = ringMap[color] ?? ringMap.green;
    return (
      <div className={`${sizeMap[size]} rounded-full overflow-hidden shrink-0 ring-2 ${ringClass}`}>
        {src ? (
          <img src={src} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className={`${colorMap[color] ?? colorMap.green} w-full h-full flex items-center justify-center`}>
            {initials}
          </div>
        )}
      </div>
    );
  }

  if (variant === "emoji" && emoji) {
    const ringClass = ringMap[color] ?? ringMap.green;
    return (
      <div
        className={`${colorMap[color] ?? colorMap.green} ${sizeMap[size]} rounded-full flex items-center justify-center shrink-0 transition-transform duration-200 hover:scale-110 active:scale-90 ring-2 ${ringClass}`}
      >
        {emoji}
      </div>
    );
  }

  return <FamilyIllustration name={name} colorName={color} size={size} />;
}