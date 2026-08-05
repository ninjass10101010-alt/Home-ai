"use client";

import AnimatedEmoji from "./AnimatedEmoji";
import SigmaImage from "./SigmaImage";

export type AvatarSize = "xs" | "sm" | "md" | "base" | "lg";

interface AvatarProps {
  name: string;
  color?: string;
  size?: AvatarSize;
  emoji?: string;
  variant?: "emoji" | "illustrated";
  skinColor?: string;
  hairColor?: string;
  glow?: boolean;
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

const glowMap: Record<string, string> = {
  green: "0 0 0 3px rgba(74, 222, 128, 0.12), 0 0 18px rgba(74, 222, 128, 0.28)",
  violet: "0 0 0 3px rgba(124, 111, 247, 0.12), 0 0 18px rgba(124, 111, 247, 0.28)",
  amber: "0 0 0 3px rgba(245, 158, 11, 0.12), 0 0 18px rgba(245, 158, 11, 0.28)",
  cyan: "0 0 0 3px rgba(6, 182, 212, 0.12), 0 0 18px rgba(6, 182, 212, 0.28)",
  rose: "0 0 0 3px rgba(244, 63, 94, 0.12), 0 0 18px rgba(244, 63, 94, 0.28)",
  blue: "0 0 0 3px rgba(59, 130, 246, 0.12), 0 0 18px rgba(59, 130, 246, 0.28)",
};

// Avatar sizing map - shared by settings and dashboard avatars.
const sizeMap: Record<AvatarSize, string> = {
  xs: "w-7 h-7",
  sm: "w-8 h-8",
  md: "w-10 h-10",
  base: "w-10 h-10",
  lg: "w-12 h-12",
};

const animatedSizeMap: Record<AvatarSize, "sm" | "md" | "lg"> = {
  xs: "sm",
  sm: "sm",
  md: "md",
  base: "md",
  lg: "lg",
};

const textMap: Record<AvatarSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-lg",
  base: "text-lg",
  lg: "text-xl",
};

const avatarSizePx: Record<AvatarSize, number> = {
  xs: 28,
  sm: 32,
  md: 40,
  base: 40,
  lg: 48,
};

function getGlowStyle(color: string, glow: boolean) {
  return glow ? { boxShadow: glowMap[color] ?? glowMap.green } : undefined;
}

// Premium illustrated SVG family member icons
function FamilyIllustration({ 
  name, colorName, size, skinColor, hairColor 
}: { 
  name: string; colorName: string; size: AvatarSize; skinColor?: string; hairColor?: string; 
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
  const w = avatarSizePx[size] ?? 40;
  const h = w;
  const isSmall = w <= 32;
  const isLarge = w >= 48;

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
        return <AnimatedEmoji emoji="🐶" name="Rocco" size={animatedSizeMap[size]} />;
      case "Rico":
      case "Rico (Poodle)":
        return <AnimatedEmoji emoji="🐩" name="Rico" size={animatedSizeMap[size]} />;
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
  name, color = "green", size = "md", emoji, variant = "illustrated", skinColor, hairColor, glow = false
}: AvatarProps) {
  const avatarSize = sizeMap[size] ?? sizeMap.md;
  const avatarTextSize = textMap[size] ?? textMap.md;
  const avatarGlow = getGlowStyle(color, glow);

  if (variant === "emoji" && emoji) {
    const isDataUrl = emoji.startsWith("data:");
    const ringClass = ringMap[color] ?? ringMap.green;
    if (isDataUrl) {
      return (
        <div
          className={`${avatarSize} rounded-full flex items-center justify-center shrink-0 overflow-hidden ring-2 ${ringClass}`}
          style={avatarGlow}
        >
          <SigmaImage src={emoji} alt={name} shape="circle" glow={glow} />
        </div>
      );
    }
    return (
      <div
        className={`${colorMap[color] ?? colorMap.green} ${avatarSize} ${avatarTextSize} rounded-full flex items-center justify-center shrink-0 transition-transform duration-200 hover:scale-110 active:scale-90 ring-2 ${ringClass}`}
        style={avatarGlow}
      >
        <AnimatedEmoji emoji={emoji} size={animatedSizeMap[size] ?? "md"} />
      </div>
    );
  }

  return <FamilyIllustration name={name} colorName={color} size={size} skinColor={skinColor} hairColor={hairColor} />;
}