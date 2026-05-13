interface AvatarProps {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  emoji?: string;
  variant?: "emoji" | "illustrated";
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

// Premium illustrated SVG family member icons
function FamilyIllustration({ name, colorName, size }: { name: string; colorName: string; size: string }) {
  const colors: Record<string, { bg: string; skin: string; hair: string; accent: string }> = {
    green: { bg: "#22c55e", skin: "#fdbcb4", hair: "#166534", accent: "#bbf7d0" },
    cyan: { bg: "#06b6d4", skin: "#fdbcb4", hair: "#155e75", accent: "#cffafe" },
    violet: { bg: "#7c6ff7", skin: "#fdbcb4", hair: "#5b21b6", accent: "#ddd6fe" },
    amber: { bg: "#f59e0b", skin: "#fdbcb4", hair: "#b45309", accent: "#fde68a" },
    rose: { bg: "#f43f5e", skin: "#fdbcb4", hair: "#be185d", accent: "#ffe4e6" },
    blue: { bg: "#3b82f6", skin: "#fdbcb4", hair: "#1e40af", accent: "#dbeafe" },
  };

  const c = colors[colorName] ?? colors.blue;
  const isSmall = size === "sm";
  const isLarge = size === "lg";
  const w = isLarge ? 48 : isSmall ? 28 : 36;
  const h = isLarge ? 48 : isSmall ? 28 : 36;

  const renderAvatar = () => {
    const baseProps = { width: w, height: h, viewBox: `0 0 ${w} ${h}` };

    switch (name) {
      case "Mom":
      case "Sarah":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id={`grad-${name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.bg} />
                <stop offset="100%" stopColor={c.accent} stopOpacity="0.5" />
              </linearGradient>
            </defs>
            {/* Body */}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            {/* Hair */}
            <ellipse cx={w/2} cy={isLarge ? 8 : 6} rx={isLarge ? 12 : 8} ry={isLarge ? 7 : 5} fill={c.hair} />
            {/* Face */}
            <circle cx={w/2} cy={h/2 + (isLarge ? 2 : 0)} r={isLarge ? 12 : 7} fill={c.skin} />
            {/* Smile */}
            <path d={`M${w/2-3} ${h/2+3} Q${w/2} ${h/2+7} ${w/2+3} ${h/2+3}`} stroke={c.hair} strokeWidth="1" fill="none" strokeLinecap="round" />
            {/* Eyes */}
            <circle cx={w/2-3} cy={h/2-1} r="1.5" fill={c.hair} />
            <circle cx={w/2+3} cy={h/2-1} r="1.5" fill={c.hair} />
            {/* Bow */}
            <circle cx={w/2+5} cy={h/2-2} r="2.5" fill={c.accent} />
          </svg>
        );
      case "Dad":
      case "Mike":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            {/* Hair */}
            <ellipse cx={w/2} cy={isLarge ? 8 : 6} rx={isLarge ? 12 : 8} ry={isLarge ? 6 : 4} fill={c.hair} />
            {/* Face */}
            <circle cx={w/2} cy={h/2 + (isLarge ? 2 : 0)} r={isLarge ? 12 : 7} fill={c.skin} />
            {/* Smile */}
            <path d={`M${w/2-3} ${h/2+3} Q${w/2} ${h/2+7} ${w/2+3} ${h/2+3}`} stroke={c.hair} strokeWidth="1" fill="none" strokeLinecap="round" />
            {/* Eyes */}
            <circle cx={w/2-3} cy={h/2-1} r="1.5" fill={c.hair} />
            <circle cx={w/2+3} cy={h/2-1} r="1.5" fill={c.hair} />
            {/* Glasses */}
            <rect x={w/2-6} y={h/2-3} width="5" height="3" rx="1" fill="none" stroke={c.hair} strokeWidth="0.8" />
            <rect x={w/2+1} y={h/2-3} width="5" height="3" rx="1" fill="none" stroke={c.hair} strokeWidth="0.8" />
            <line x1={w/2-1} y1={h/2-1.5} x2={w/2+1} y2={h/2-1.5} stroke={c.hair} strokeWidth="0.8" />
          </svg>
        );
      case "Jake":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            {/* Hair */}
            <ellipse cx={w/2} cy={isLarge ? 8 : 6} rx={isLarge ? 11 : 7} ry={isLarge ? 6 : 4} fill={c.hair} />
            {/* Face */}
            <circle cx={w/2} cy={h/2 + (isLarge ? 2 : 0)} r={isLarge ? 11 : 6.5} fill={c.skin} />
            {/* Smile */}
            <path d={`M${w/2-3} ${h/2+3} Q${w/2} ${h/2+7} ${w/2+3} ${h/2+3}`} stroke={c.hair} strokeWidth="1" fill="none" strokeLinecap="round" />
            {/* Eyes */}
            <circle cx={w/2-3} cy={h/2-1} r="1.5" fill={c.hair} />
            <circle cx={w/2+3} cy={h/2-1} r="1.5" fill={c.hair} />
            {/* Soccer ball hat */}
            <circle cx={w/2} cy={isLarge ? 5 : 3} r={isLarge ? 5 : 3.5} fill="none" stroke={c.accent} strokeWidth="0.8" />
            <circle cx={w/2} cy={isLarge ? 5 : 3} r="1.2" fill={c.accent} />
          </svg>
        );
      case "Lily":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            {/* Hair with pigtails */}
            <ellipse cx={w/2} cy={isLarge ? 7 : 5} rx={isLarge ? 11 : 7} ry={isLarge ? 6 : 4} fill={c.hair} />
            <circle cx={w/2-7} cy={isLarge ? 8 : 5} r={isLarge ? 3.5 : 2.5} fill={c.hair} />
            <circle cx={w/2+7} cy={isLarge ? 8 : 5} r={isLarge ? 3.5 : 2.5} fill={c.hair} />
            {/* Face */}
            <circle cx={w/2} cy={h/2 + (isLarge ? 2 : 0)} r={isLarge ? 11 : 6.5} fill={c.skin} />
            {/* Smile */}
            <path d={`M${w/2-3} ${h/2+3} Q${w/2} ${h/2+7} ${w/2+3} ${h/2+3}`} stroke={c.hair} strokeWidth="1" fill="none" strokeLinecap="round" />
            {/* Eyes */}
            <circle cx={w/2-3} cy={h/2-1} r="1.5" fill={c.hair} />
            <circle cx={w/2+3} cy={h/2-1} r="1.5" fill={c.hair} />
            {/* Flower */}
            <circle cx={w/2+5} cy={h/2-4} r="2.5" fill={c.accent} opacity="0.7" />
          </svg>
        );
      default:
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            <circle cx={w/2} cy={h/2} r={isLarge ? 10 : 6} fill={c.skin} />
            <circle cx={w/2-2} cy={h/2-1} r="1.5" fill={c.hair} />
            <circle cx={w/2+2} cy={h/2-1} r="1.5" fill={c.hair} />
            <path d={`M${w/2-2} ${h/2+2} Q${w/2} ${h/2+5} ${w/2+2} ${h/2+2}`} stroke={c.hair} strokeWidth="1" fill="none" />
          </svg>
        );
    }
  };

  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold shrink-0 overflow-hidden ${sizeMap[size]}`}
      style={{ backgroundColor: c.bg + "15", border: `2px solid ${c.bg}30` }}
    >
      {renderAvatar()}
    </div>
  );
}

export default function Avatar({ name, color = "green", size = "md", emoji, variant = "illustrated" }: AvatarProps) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

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