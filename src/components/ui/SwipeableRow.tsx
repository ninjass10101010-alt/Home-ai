"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

interface SwipeableRowProps {
  children: ReactNode;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  className?: string;
}

const THRESHOLD = 48;
const MAX_OFFSET = 88;
const SNAP_MS = 180;

export default function SwipeableRow({ children, leftAction, rightAction, onSwipeRight, onSwipeLeft, className = "" }: SwipeableRowProps) {
  const startXRef = useRef(0);
  const draggingRef = useRef(false);
  const velocityRef = useRef(0);
  const lastXRef = useRef(0);
  const lastTimeRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const [grabbing, setGrabbing] = useState(false);

  const finishSwipe = useCallback((delta: number) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setGrabbing(false);
    const velocity = velocityRef.current;
    const fastRight = velocity > 0.4;
    const fastLeft = velocity < -0.4;
    let nextOffset: number;

    if (fastRight || delta > THRESHOLD) {
      nextOffset = MAX_OFFSET;
    } else if (fastLeft || delta < -THRESHOLD) {
      nextOffset = -MAX_OFFSET;
    } else {
      nextOffset = 0;
    }

    setSnapping(true);
    setOffset(nextOffset);

    if (nextOffset > 0) onSwipeRight?.();
    else if (nextOffset < 0) onSwipeLeft?.();

    requestAnimationFrame(() => {
      setTimeout(() => setSnapping(false), SNAP_MS);
    });
  }, [onSwipeRight, onSwipeLeft]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setGrabbing(true);
    startXRef.current = e.clientX;
    lastXRef.current = e.clientX;
    lastTimeRef.current = Date.now();
    velocityRef.current = 0;
    setSnapping(false);
    setOffset(0);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const now = Date.now();
    const dt = now - lastTimeRef.current;
    if (dt > 0) {
      velocityRef.current = (e.clientX - lastXRef.current) / dt;
    }
    lastXRef.current = e.clientX;
    lastTimeRef.current = now;
    const delta = e.clientX - startXRef.current;
    setOffset(Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, delta)));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    finishSwipe(e.clientX - startXRef.current);
  }, [finishSwipe]);

  const handlePointerCancel = useCallback(() => {
    draggingRef.current = false;
    setGrabbing(false);
    setSnapping(true);
    setOffset(0);
    requestAnimationFrame(() => {
      setTimeout(() => setSnapping(false), SNAP_MS);
    });
  }, []);

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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{
          transform: `translateX(${offset}px)`,
          transition: snapping ? `transform ${SNAP_MS}ms cubic-bezier(0.2, 0, 0, 1)` : "none",
          touchAction: "none",
          cursor: grabbing ? "grabbing" : "grab",
        }}
      >
        {children}
      </div>
    </div>
  );
}