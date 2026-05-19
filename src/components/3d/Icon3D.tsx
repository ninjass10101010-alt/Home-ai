"use client";

import { SVGProps } from "react";

interface Icon3DProps extends SVGProps<SVGSVGElement> {
  variant?: "calendar" | "grocery" | "meals" | "tasks" | "chat" | "weather" | "family" | "clock";
  size?: "sm" | "md" | "lg";
  animated?: boolean;
}

const sizeClasses = {
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-16 h-16",
};

const gradientColors = {
  calendar: ["#7c6ff7", "#4ade80"],
  grocery: ["#f59e0b", "#ff6b8a"],
  meals: ["#4ade80", "#06b6d4"],
  tasks: ["#06b6d4", "#7c6ff7"],
  chat: ["#b583ff", "#ff6b8a"],
  weather: ["#60a5fa", "#06b6d4"],
  family: ["#f43f5e", "#f59e0b"],
  clock: ["#4ade80", "#7c6ff7"],
};

export default function Icon3D({ variant = "calendar", size = "md", animated = true, className = "", ...props }: Icon3DProps) {
  const sizeClass = sizeClasses[size];
  const [startColor, endColor] = gradientColors[variant];

  const renderIcon = () => {
    switch (variant) {
      case "calendar":
        return (
          <g>
            <rect x="2" y="4" width="18" height="18" rx="2" fill={`url(#gradient-${variant})`} />
            <path d="M16 2v6M8 2v6M2 12h20" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        );
      case "grocery":
        return (
          <g>
            <path d="M6 8h12M6 12h12M8 16h8M5 4l2 4h10l2-4H5z" fill={`url(#gradient-${variant})`} stroke="white" strokeWidth="1" />
            <circle cx="8" cy="18" r="2" fill={`url(#gradient-${variant})`} stroke="white" strokeWidth="1" />
            <circle cx="16" cy="18" r="2" fill={`url(#gradient-${variant})`} stroke="white" strokeWidth="1" />
          </g>
        );
      case "meals":
        return (
          <g>
            <path d="M12 2H8a4 4 0 0 0-4 4v12a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V12" fill={`url(#gradient-${variant})`} stroke="white" strokeWidth="1" />
            <path d="M12 2v10l4 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="12" r="3" fill="none" stroke="white" strokeWidth="1" />
          </g>
        );
      case "tasks":
        return (
          <g>
            <rect x="2" y="4" width="20" height="16" rx="2" fill={`url(#gradient-${variant})`} />
            <path d="M6 12h12M10 8l-2 2 2 2M14 14l2-2-2-2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        );
      case "chat":
        return (
          <g>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill={`url(#gradient-${variant})`} />
            <circle cx="9" cy="10" r="1.5" fill="white" />
            <circle cx="15" cy="10" r="1.5" fill="white" />
          </g>
        );
      case "weather":
        return (
          <g>
            <circle cx="12" cy="12" r="5" fill={`url(#gradient-${variant})`} />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="white" strokeWidth="1" strokeLinecap="round" />
          </g>
        );
      case "family":
        return (
          <g>
            <circle cx="8" cy="8" r="4" fill={`url(#gradient-${variant})`} />
            <circle cx="16" cy="8" r="4" fill={`url(#gradient-${variant})`} />
            <path d="M12 16c-3.31 0-6-2.69-6-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M6 18c0 1.1.9 2 2 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M18 18c0 1.1-.9 2-2 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        );
      case "clock":
        return (
          <g>
            <circle cx="12" cy="12" r="9" fill={`url(#gradient-${variant})`} />
            <circle cx="12" cy="12" r="3" fill="none" stroke="white" strokeWidth="1" />
            <path d="M12 12V8" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 12l3 3" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </g>
        );
      default:
        return null;
    }
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={`${sizeClass} ${animated ? "floating" : ""} ${className}`}
      {...props}
    >
      <defs>
        <linearGradient id={`gradient-${variant}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={startColor} />
          <stop offset="100%" stopColor={endColor} />
        </linearGradient>
      </defs>
      {renderIcon()}
    </svg>
  );
}