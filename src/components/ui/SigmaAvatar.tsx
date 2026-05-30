"use client";

import SigmaImage from "./SigmaImage";

interface SigmaAvatarProps {
  src?: string;
  alt?: string;
  glow?: boolean;
  size?: "xs" | "sm" | "base" | "lg";
  shape?: "rounded" | "circle";
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
  fallback?: React.ReactNode;
}

const sizeMap = {
  xs: "h-6 w-6 text-xs",
  sm: "h-10 w-10 text-xs",
  base: "h-16 w-16 text-2xl",
  lg: "h-32 w-32 text-5xl",
};

export default function SigmaAvatar({
  src,
  alt = "avatar",
  glow = false,
  size = "base",
  shape = "circle",
  className = "",
  onLoad,
  onError,
  fallback,
}: SigmaAvatarProps) {
  return (
    <div className={`${sizeMap[size]} select-none shrink-0 ${className}`}>
      <SigmaImage
        src={src}
        alt={alt}
        glow={glow}
        shape={shape}
        onLoad={onLoad}
        onError={onError}
        fallback={
          fallback || (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[40%] h-[40%] text-primary/50">
              <path d="M19 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2" strokeLinecap="round" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )
        }
      />
    </div>
  );
}
