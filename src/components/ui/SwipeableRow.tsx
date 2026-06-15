"use client";

import { useRef, useState, type ReactNode } from "react";

interface SwipeableRowProps {
  children: ReactNode;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  className?: string;
}

export default function SwipeableRow({ children, leftAction, rightAction, onSwipeRight, onSwipeLeft, className = "" }: SwipeableRowProps) {
  const startX = useRef(0);
  const didFinishSwipe = useRef(false);
  const [offset, setOffset] = useState(0);

  const finishSwipe = (delta: number) => {
    if (didFinishSwipe.current) return;
    didFinishSwipe.current = true;
    const nextOffset = delta > 48 ? 88 : delta < -48 ? -88 : 0;
    setOffset(nextOffset);
    if (nextOffset > 0) onSwipeRight?.();
    else if (nextOffset < 0) onSwipeLeft?.();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    didFinishSwipe.current = false;
    startX.current = event.clientX;
    setOffset(0);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const delta = event.clientX - startX.current;
    setOffset(Math.max(-88, Math.min(88, delta)));
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    didFinishSwipe.current = false;
    startX.current = event.touches[0].clientX;
    setOffset(0);
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const delta = event.touches[0].clientX - startX.current;
    setOffset(Math.max(-88, Math.min(88, delta)));
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    finishSwipe(event.changedTouches[0].clientX - startX.current);
  };

  const onTouchCancel = () => {
    didFinishSwipe.current = false;
    setOffset(0);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    finishSwipe(event.clientX - startX.current);
  };

  const onPointerCancel = () => {
    didFinishSwipe.current = false;
    setOffset(0);
  };

  const onPointerLeave = () => {
    didFinishSwipe.current = false;
    setOffset(0);
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`} style={{ touchAction: "none" }}>
      <div className="absolute inset-y-0 left-0 flex w-20 items-center justify-start rounded-l-2xl bg-emerald-500/20 text-emerald-300">
        {leftAction}
      </div>
      <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-end rounded-r-2xl bg-rose-500/20 text-rose-300">
        {rightAction}
      </div>
      <div
        className="touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        style={{ transform: `translateX(${offset}px)`, transition: "transform 180ms cubic-bezier(0.2, 0, 0, 1)", touchAction: "none", cursor: "grab" }}
      >
        {children}
      </div>
    </div>
  );
}
