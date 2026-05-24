"use client";

import AnimatedEmoji from "./AnimatedEmoji";

interface AvatarProps {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  emoji?: string;
  variant?: "emoji" | "illustrated";
  skinColor?: string;
  hairColor?: string;
}

const colorMap: Record<string, string> = {
  green: "bg-[var(--color-accent-mint)] text-[var(--color-text-on-accent)]",
  violet: "bg-[var(--color-accent-violet)]/20 text-[var(--color-accent-violet)]",
  amber: "bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-amber)]",
  cyan: "bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]",
  rose: "bg-[var(--color-accent-rose)]/20 text-[var(--color-accent-rose)]",
  blue: "bg-[var(--color-accent-nori)]/20 text-[var(--color-accent-nori)]",
};

// Ring color mapping for emoji variant
const ringMap: Record<string, string> = {
  green: "ring-[var(--color-accent-mint)]/30",
  violet: "ring-[var(--color-accent-violet)]/40",
  amber: "ring-[var(--color-accent-amber)]/30",
  cyan: "ring-[var(--color-accent-cyan)]/30",
  rose: "ring-[var(--color-accent-rose)]/30",
  blue: "ring-[var(--color-accent-nori)]/30",
};

// Avatar sizing map - typed as Record<string, string> to allow indexing
const sizeMap: Record<string, string> = {
  sm: "w-7 h-7 text-xs",
  md: "w-9 h-9 text-sm",
  lg: "w-12 h-12 text-base",
};

// Premium illustrated SVG family member icons
function FamilyIllustration({ 
  name, colorName, size, skinColor, hairColor 
}: { 
  name: string; colorName: string; size: string; skinColor?: string; hairColor?: string; 
}) {
  const colors: Record<string, { bg: string; skin: string; hair: string; accent: string }> = {
    green: { bg: "#22c55e", skin: "#fdbcb4", hair: "#166534", accent: "#bbf7d0" },
    cyan: { bg: "#06b6d4", skin: "#fdbcb4", hair: "#155e75", accent: "#cffafe" },
    violet: { bg: "#7c6ff7", skin: "#fdbcb4", hair: "#5b21b6", accent: "#ddd6fe" },
    amber: { bg: "#f59e0b", skin: "#fdbcb4", hair: "#b45309", accent: "#fde68a" },
    rose: { bg: "#f43f5e", skin: "#fdbcb4", hair: "#be185d", accent: "#ffe4e6" },
    blue: { bg: "#3b82f6", skin: "#fdbcb4", hair: "#1e40af", accent: "#dbeafe" },
  };

  const c = colors[colorName] ?? colors.blue;
  const actualSkin = skinColor || c.skin;
  const actualHair = hairColor || c.hair;
  const isSmall = size === "sm";
  const isLarge = size === "lg";
  const w = isLarge ? 48 : isSmall ? 28 : 36;
  const h = isLarge ? 48 : isSmall ? 28 : 36;

  const renderAvatar = () => {
    const baseProps = { width: w, height: h, viewBox: `0 0 ${w} ${h}` };
    const headStyle = { animation: "headBob 4s ease-in-out infinite" };
    const blinkStyle = { animation: "blink 4s infinite" };

    const defsAndStyles = (
      <>
        <style>{`
          @keyframes headBob {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-1.5px); }
          }
          @keyframes blink {
            0%, 96%, 98%, 100% { transform: scaleY(1); opacity: 1; }
            97% { transform: scaleY(0.1); opacity: 0.8; }
          }
        `}</style>
      </>
    );

    switch (name) {
      case "Mom":
      case "Rebecca":
      case "Rebecca (Mom)":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            {defsAndStyles}
            <defs>
              <linearGradient id={`grad-${name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.bg} />
                <stop offset="100%" stopColor={c.accent} stopOpacity="0.5" />
              </linearGradient>
            </defs>
            {/* Body */}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            
            <g style={headStyle} transform-origin={`${w/2}px ${h/2}px`}>
              {/* Hair */}
              <ellipse cx={w/2} cy={isLarge ? 8 : 6} rx={isLarge ? 12 : 8} ry={isLarge ? 7 : 5} fill={actualHair} />
              {/* Face */}
              <circle cx={w/2} cy={h/2 + (isLarge ? 2 : 0)} r={isLarge ? 12 : 7} fill={actualSkin} />
              {/* Smile */}
              <path d={`M${w/2-3} ${h/2+3} Q${w/2} ${h/2+7} ${w/2+3} ${h/2+3}`} stroke={actualHair} strokeWidth="1" fill="none" strokeLinecap="round" />
              {/* Eyes */}
              <g style={blinkStyle} transform-origin={`${w/2}px ${h/2-1}px`}>
                <circle cx={w/2-3} cy={h/2-1} r="1.5" fill={actualHair} />
                <circle cx={w/2+3} cy={h/2-1} r="1.5" fill={actualHair} />
              </g>
              {/* Bow */}
              <circle cx={w/2+5} cy={h/2-2} r="2.5" fill={c.accent} />
            </g>
          </svg>
        );
      case "Dad":
      case "Jeffery":
      case "Jeffery (Dad)":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            {defsAndStyles}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            
            <g style={headStyle} transform-origin={`${w/2}px ${h/2}px`}>
              {/* Hair */}
              <ellipse cx={w/2} cy={isLarge ? 8 : 6} rx={isLarge ? 12 : 8} ry={isLarge ? 6 : 4} fill={actualHair} />
              {/* Face */}
              <circle cx={w/2} cy={h/2 + (isLarge ? 2 : 0)} r={isLarge ? 12 : 7} fill={actualSkin} />
              {/* Smile */}
              <path d={`M${w/2-3} ${h/2+3} Q${w/2} ${h/2+7} ${w/2+3} ${h/2+3}`} stroke={actualHair} strokeWidth="1" fill="none" strokeLinecap="round" />
              {/* Eyes */}
              <g style={blinkStyle} transform-origin={`${w/2}px ${h/2-1}px`}>
                <circle cx={w/2-3} cy={h/2-1} r="1.5" fill={actualHair} />
                <circle cx={w/2+3} cy={h/2-1} r="1.5" fill={actualHair} />
              </g>
              {/* Glasses */}
              <rect x={w/2-6} y={h/2-3} width="5" height="3" rx="1" fill="none" stroke={actualHair} strokeWidth="0.8" />
              <rect x={w/2+1} y={h/2-3} width="5" height="3" rx="1" fill="none" stroke={actualHair} strokeWidth="0.8" />
              <line x1={w/2-1} y1={h/2-1.5} x2={w/2+1} y2={h/2-1.5} stroke={actualHair} strokeWidth="0.8" />
            </g>
          </svg>
        );
      case "Caspian":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            {defsAndStyles}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            <g style={headStyle} transform-origin={`${w/2}px ${h/2}px`}>
              {/* Hair */}
              <ellipse cx={w/2} cy={isLarge ? 8 : 6} rx={isLarge ? 11 : 7} ry={isLarge ? 6 : 4} fill={actualHair} />
              {/* Face */}
              <circle cx={w/2} cy={h/2 + (isLarge ? 2 : 0)} r={isLarge ? 11 : 6.5} fill={actualSkin} />
              {/* Smile */}
              <path d={`M${w/2-3} ${h/2+3} Q${w/2} ${h/2+7} ${w/2+3} ${h/2+3}`} stroke={actualHair} strokeWidth="1" fill="none" strokeLinecap="round" />
              {/* Eyes */}
              <g style={blinkStyle} transform-origin={`${w/2}px ${h/2-1}px`}>
                <circle cx={w/2-3} cy={h/2-1} r="1.5" fill={actualHair} />
                <circle cx={w/2+3} cy={h/2-1} r="1.5" fill={actualHair} />
              </g>
              {/* Soccer ball hat */}
              <circle cx={w/2} cy={isLarge ? 5 : 3} r={isLarge ? 5 : 3.5} fill="none" stroke={c.accent} strokeWidth="0.8" />
              <circle cx={w/2} cy={isLarge ? 5 : 3} r="1.2" fill={c.accent} />
            </g>
          </svg>
        );
      case "Emily":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            {defsAndStyles}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            <g style={headStyle} transform-origin={`${w/2}px ${h/2}px`}>
              {/* Hair with pigtails */}
              <ellipse cx={w/2} cy={isLarge ? 7 : 5} rx={isLarge ? 11 : 7} ry={isLarge ? 6 : 4} fill={actualHair} />
              <circle cx={w/2-7} cy={isLarge ? 8 : 5} r={isLarge ? 3.5 : 2.5} fill={actualHair} />
              <circle cx={w/2+7} cy={isLarge ? 8 : 5} r={isLarge ? 3.5 : 2.5} fill={actualHair} />
              {/* Face */}
              <circle cx={w/2} cy={h/2 + (isLarge ? 2 : 0)} r={isLarge ? 11 : 6.5} fill={actualSkin} />
              {/* Smile */}
              <path d={`M${w/2-3} ${h/2+3} Q${w/2} ${h/2+7} ${w/2+3} ${h/2+3}`} stroke={actualHair} strokeWidth="1" fill="none" strokeLinecap="round" />
              {/* Eyes */}
              <g style={blinkStyle} transform-origin={`${w/2}px ${h/2-1}px`}>
                <circle cx={w/2-3} cy={h/2-1} r="1.5" fill={actualHair} />
                <circle cx={w/2+3} cy={h/2-1} r="1.5" fill={actualHair} />
              </g>
              {/* Flower */}
              <circle cx={w/2+5} cy={h/2-4} r="2.5" fill={c.accent} opacity="0.7" />
            </g>
          </svg>
        );
      case "Bailey":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            {defsAndStyles}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            <g style={headStyle} transform-origin={`${w/2}px ${h/2}px`}>
              <circle cx={w/2} cy={h/2} r={isLarge ? 10 : 6} fill={actualSkin} />
              <g style={blinkStyle} transform-origin={`${w/2}px ${h/2-1}px`}>
                <circle cx={w/2-2} cy={h/2-1} r="1.5" fill={actualHair} />
                <circle cx={w/2+2} cy={h/2-1} r="1.5" fill={actualHair} />
              </g>
              <path d={`M${w/2-2} ${h/2+2} Q${w/2} ${h/2+5} ${w/2+2} ${h/2+2}`} stroke={actualHair} strokeWidth="1" fill="none" />
            </g>
          </svg>
        );
      case "Jasmine":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            {defsAndStyles}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            <g style={headStyle} transform-origin={`${w/2}px ${h/2}px`}>
              <circle cx={w/2} cy={h/2} r={isLarge ? 10 : 6} fill={actualSkin} />
              <g style={blinkStyle} transform-origin={`${w/2}px ${h/2-1}px`}>
                <circle cx={w/2-2} cy={h/2-1} r="1.5" fill={actualHair} />
                <circle cx={w/2+2} cy={h/2-1} r="1.5" fill={actualHair} />
              </g>
              <path d={`M${w/2-2} ${h/2+2} Q${w/2} ${h/2+5} ${w/2+2} ${h/2+2}`} stroke={actualHair} strokeWidth="1" fill="none" />
            </g>
          </svg>
        );
      case "Aurora":
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            {defsAndStyles}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            <g style={headStyle} transform-origin={`${w/2}px ${h/2}px`}>
              <circle cx={w/2} cy={h/2} r={isLarge ? 10 : 6} fill={actualSkin} />
              <g style={blinkStyle} transform-origin={`${w/2}px ${h/2-1}px`}>
                <circle cx={w/2-2} cy={h/2-1} r="1.5" fill={actualHair} />
                <circle cx={w/2+2} cy={h/2-1} r="1.5" fill={actualHair} />
              </g>
              <path d={`M${w/2-2} ${h/2+2} Q${w/2} ${h/2+5} ${w/2+2} ${h/2+2}`} stroke={actualHair} strokeWidth="1" fill="none" />
            </g>
          </svg>
        );
      case "Rocco":
      case "Rocco (Frenchie)":
        return <AnimatedEmoji emoji="🐶" name="Rocco" size={size as any} />;
      case "Rico":
      case "Rico (Poodle)":
        return <AnimatedEmoji emoji="🐩" name="Rico" size={size as any} />;
      default:
        return (
          <svg {...baseProps} xmlns="http://www.w3.org/2000/svg">
            {defsAndStyles}
            <circle cx={w/2} cy={h/2} r={w/2 - 1} fill={c.bg} opacity="0.15" />
            <g style={headStyle} transform-origin={`${w/2}px ${h/2}px`}>
              <circle cx={w/2} cy={h/2} r={isLarge ? 10 : 6} fill={actualSkin} />
              <g style={blinkStyle} transform-origin={`${w/2}px ${h/2-1}px`}>
                <circle cx={w/2-2} cy={h/2-1} r="1.5" fill={actualHair} />
                <circle cx={w/2+2} cy={h/2-1} r="1.5" fill={actualHair} />
              </g>
              <path d={`M${w/2-2} ${h/2+2} Q${w/2} ${h/2+5} ${w/2+2} ${h/2+2}`} stroke={actualHair} strokeWidth="1" fill="none" />
            </g>
          </svg>
        );
    }
  };

  const isPet = ["Rocco", "Rico"].some(p => name.includes(p));

  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold shrink-0 overflow-hidden ${sizeMap[size]}`}
      style={!isPet ? { backgroundColor: c.bg + "15", border: `2px solid ${c.bg}30` } : undefined}
    >
      {renderAvatar()}
    </div>
  );
}

export default function Avatar({ 
  name, color = "green", size = "md", emoji, variant = "illustrated", skinColor, hairColor 
}: AvatarProps) {
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
        <AnimatedEmoji emoji={emoji} size={size as any} />
      </div>
    );
  }

  return <FamilyIllustration name={name} colorName={color} size={size} skinColor={skinColor} hairColor={hairColor} />;
}