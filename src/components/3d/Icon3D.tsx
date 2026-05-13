"use client";

import { SVGProps } from "react";
import { motion } from "framer-motion";

type IconVariant = "calendar" | "grocery" | "meals" | "tasks" | "chat" | "weather" | "family" | "clock";

interface Icon3DProps extends SVGProps<SVGSVGElement> {

  variant?: IconVariant;
  size?: "sm" | "md" | "lg";
  animated?: boolean;
}


const sizeClasses = {
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-16 h-16",
};

const gradientColors: Record<IconVariant, string[]> = {

  calendar: ["#7c6ff7", "#4ade80"],
  grocery: ["#f59e0b", "#ff6b8a"],
  meals: ["#4ade80", "#06b6d4"],
  tasks: ["#06b6d4", "#7c6ff7"],
  chat: ["#f59e0b", "#3b82f6"],
  weather: ["#60a5fa", "#06b6d4"],
  family: ["#f43f5e", "#f59e0b"],
  clock: ["#4ade80", "#7c6ff7"],
};

export default function Icon3D({ variant = "calendar", size = "md", animated = true, className = "", ...props }: Icon3DProps) {
  const { 
    onAnimationStart, onAnimationEnd, onAnimationIteration, 
    onDragStart, onDragEnd, onDrag,
    ...svgProps 
  } = props;

  const sizeClass = sizeClasses[size];


  const [startColor, endColor] = gradientColors[variant];

  const renderIcon = () => {
    switch (variant) {
      case "calendar":
        return (
          <g>
            <rect x="2" y="4" width="18" height="18" rx="4" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <rect x="2" y="4" width="18" height="6" rx="2" fill="white" fillOpacity="0.2" />
            <path d="M16 2v6M8 2v6M2 12h20" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.8" />
          </g>
        );
      case "grocery":
        return (
          <g>
            <path d="M6 8h12M6 12h12M8 16h8M5 4l2 4h10l2-4H5z" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <circle cx="8" cy="18" r="2" fill={`url(#gradient-${variant})`} stroke="white" strokeWidth="1" />
            <circle cx="16" cy="18" r="2" fill={`url(#gradient-${variant})`} stroke="white" strokeWidth="1" />
            <path d="M7 8h10M9 4v4M15 4v4" stroke="white" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.5" />
          </g>
        );
      case "meals":
        return (
          <g>
            <path d="M12 2H8a4 4 0 0 0-4 4v12a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V12" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <circle cx="12" cy="12" r="5" fill="white" fillOpacity="0.1" />
            <path d="M12 2v10l4 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="12" r="3" fill="none" stroke="white" strokeWidth="1" />
          </g>
        );
      case "tasks":
        return (
          <g>
            <rect x="2" y="4" width="20" height="16" rx="4" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <path d="M7 10l3 3 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="6" y="14" width="12" height="2" rx="1" fill="white" fillOpacity="0.4" />
          </g>
        );
      case "chat":
        return (
          <g>
            <path d="M21 15a3 3 0 0 1-3 3H7l-4 4V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <rect x="7" y="8" width="10" height="2" rx="1" fill="white" fillOpacity="0.3" />
            <rect x="7" y="12" width="6" height="2" rx="1" fill="white" fillOpacity="0.3" />
          </g>
        );
      case "weather":
        return (
          <g>
            <circle cx="12" cy="12" r="6" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="white" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.6" />
          </g>
        );
      case "family":
        return (
          <g>
            <circle cx="8" cy="8" r="4" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <circle cx="16" cy="8" r="4" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <path d="M6 18c0-3 2-5 6-5s6 2 6 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.8" />
          </g>
        );
      case "clock":
        return (
          <g>
            <circle cx="12" cy="12" r="9" fill={`url(#gradient-${variant})`} filter="url(#shadow)" />
            <path d="M12 7v5l3 3" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="1.5" fill="white" />
          </g>
        );
      default:
        return null;
    }
  };

  const animation = animated ? {
    y: [0, -8, 0],
    rotateX: [5, 0, 5],
    rotateY: [-5, 0, -5],
  } : undefined;

  const transition = animated ? {
    duration: 4,
    repeat: Infinity,
    ease: "easeInOut",
  } : undefined;

  return (

    <motion.svg
      viewBox="0 0 24 24"
      className={`${sizeClass} ${className}`}
      animate={animation as any}
      transition={transition as any}
      style={{ perspective: "1000px" }}
      {...(svgProps as any)}
    >



      <defs>
        <linearGradient id={`gradient-${variant}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={startColor} />
          <stop offset="100%" stopColor={endColor} />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1" />
          <feOffset dx="1" dy="1" result="offsetblur" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.3" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {renderIcon()}
    </motion.svg>
  );
}