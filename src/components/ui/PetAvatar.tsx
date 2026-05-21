"use client";

import { useEffect, useState, useRef } from "react";

export default function PetAvatar({ state = "idle" }: { state?: string }) {
  const [currentSvg, setCurrentSvg] = useState<string>(`/pet-states/${state}.svg`);
  const [prevSvg, setPrevSvg] = useState<string | null>(null);
  const fadeRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (`/pet-states/${state}.svg` !== currentSvg) {
      setPrevSvg(currentSvg);
      setCurrentSvg(`/pet-states/${state}.svg`);
      
      if (fadeRef.current) clearTimeout(fadeRef.current);
      fadeRef.current = setTimeout(() => {
        setPrevSvg(null);
      }, 300); // Cross-fade duration
    }
  }, [state, currentSvg]);

  return (
    <div className="relative w-16 h-16 pointer-events-none" style={{ filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.1))" }}>
      {prevSvg && (
        <object
          type="image/svg+xml"
          data={prevSvg}
          className="absolute inset-0 w-full h-full opacity-0 transition-opacity duration-300 ease-out"
        />
      )}
      <object
        type="image/svg+xml"
        data={currentSvg}
        className="absolute inset-0 w-full h-full opacity-100 transition-opacity duration-300 ease-out"
      />
    </div>
  );
}
