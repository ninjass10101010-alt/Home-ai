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

  // The ✓/✕ layers are painted UNDER the translucent row content (`.schedule-row`
  // is 72–75% opaque), so at rest they ghosted through every pending row — a
  // dimmed rose ✕ band on the right ~80px. They fade in only as the row is
  // actually dragged off them: fully transparent at offset 0, fully opaque from
  // |offset| ≥ 24px (a vertical scroll's 1–2px horizontal drift stays
  // invisible), following the same snap timing as the content's own slide.
  const reveal = offset === 0 ? 0 : Math.min(1, Math.abs(offset) / 24);
  const layerStyle = {
    opacity: reveal,
    transition: snapping ? `opacity ${SNAP_MS}ms cubic-bezier(0.2, 0, 0, 1)` : "none",
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      <div
        className="absolute inset-y-0 left-0 flex w-20 items-center justify-start rounded-l-2xl bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]"
        style={layerStyle}
      >
        {leftAction}
      </div>
      <div
        className="absolute inset-y-0 right-0 flex w-20 items-center justify-end rounded-r-2xl bg-[var(--color-accent-rose)]/20 text-[var(--color-accent-rose)]"
        style={layerStyle}
      >
        {rightAction}
      </div>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{
          transform: `translateX(${offset}px)`,
          transition: snapping ? `transform ${SNAP_MS}ms cubic-bezier(0.2, 0, 0, 1)` : "none",
          touchAction: "pan-y",
          cursor: grabbing ? "grabbing" : "grab",
        }}
      >
        {children}
      </div>
    </div>
  );
}