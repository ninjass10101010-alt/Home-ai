"use client";

import { useRef, useState, type ReactNode } from "react";

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => void;
  className?: string;
}

export default function PullToRefresh({ children, onRefresh, className = "" }: PullToRefreshProps) {
  const startY = useRef(0);
  const [pull, setPull] = useState(0);

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    startY.current = event.touches[0]?.clientY || 0;
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const currentY = event.touches[0]?.clientY || 0;
    const delta = Math.max(0, currentY - startY.current);
    setPull(Math.min(delta, 96));
  };

  const onTouchEnd = () => {
    if (pull > 72) onRefresh();
    setPull(0);
  };

  return (
    <div className={className} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="flex items-center justify-center overflow-hidden" style={{ height: pull, transition: "height 160ms ease-out" }}>
        <span className="text-xs font-semibold text-text-muted">Release to refresh</span>
      </div>
      {children}
    </div>
  );
}
