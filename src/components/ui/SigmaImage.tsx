"use client";

import { useState } from "react";

interface SigmaImageProps {
  src?: string;
  alt?: string;
  glow?: boolean;
  shape?: "rounded" | "circle";
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
  fallback?: React.ReactNode;
}

export default function SigmaImage({
  src,
  alt = "image",
  glow = false,
  shape = "rounded",
  className = "",
  onLoad,
  onError,
  fallback,
}: SigmaImageProps) {
  const [isError, setIsError] = useState(!src);
  const [isLoading, setIsLoading] = useState(!!src);

  const shapeClass = shape === "circle" ? "rounded-full [&_img]:rounded-full" : "rounded-md [&_img]:rounded-md";
  const imgCornerClass = shape === "circle" ? "rounded-full" : "rounded-md";


  const handleError = () => {
    onError?.();
    setIsError(true);
    setIsLoading(false);
  };

  const handleLoad = () => {
    onLoad?.();
    setIsError(false);
    setIsLoading(false);
  };

  return (
    <div
      className={`relative w-full h-full flex items-center justify-center font-normal select-none shrink-0 bg-secondary/30 ${shapeClass} ${!glow ? "overflow-hidden" : ""} ${className}`}
    >
      {/* Error fallback */}
      {isError && (
        <div className="animate-fade-in flex items-center justify-center w-full h-full">
          {fallback || (
            <div className="flex flex-col gap-1 items-center justify-center text-foreground/50">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[50%] max-w-[50px] h-[50%] max-h-[50px]">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[10px]">no photo</span>
            </div>
          )}
        </div>
      )}

      {/* Loading spinner + images */}
      {!isError && (
        <div className="flex items-center justify-center w-full h-full">
          {isLoading && (
            <div className="animate-fade-in">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          )}

          {/* Glow layer (blurred) */}
          {glow && !isError && src && (
            <img
              src={src}
              alt={alt}
              onError={handleError}
              onLoad={handleLoad}
              className={`${isLoading ? "hidden" : ""} z-[1] animate-fade-in absolute left-0 top-[2%] w-full h-full scale-105 object-cover blur-lg brightness-200 saturate-200 dark:brightness-100 ${imgCornerClass}`}
            />
          )}

          {/* Main image */}
          {!isError && src && (
          <img
              src={src}
              alt={alt}
              referrerPolicy="no-referrer"
              onError={handleError}
              onLoad={handleLoad}
              className={`${isLoading ? "hidden" : ""} z-[2] relative animate-fade-in w-full h-full object-cover ${imgCornerClass}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
