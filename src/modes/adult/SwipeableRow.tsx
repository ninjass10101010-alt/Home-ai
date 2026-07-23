/**
 * SwipeableRow — iOS-style swipe-to-action row for Adult Mode.
 *
 * Swipe left to reveal action buttons (complete, delete, skip).
 * Uses pointer events for smooth tracking.
 */
"use client";

import { useRef, useState, useCallback, type ReactNode } from "react";

interface SwipeAction {
  label: string;
  icon: string;
  color: string;
  onClick: () => void;
}

interface SwipeableRowProps {
  children: ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  onReset?: () => void;
}

const ACTION_WIDTH = 72;
const THRESHOLD = 60;

export default function SwipeableRow({
  children,
  leftActions = [],
  rightActions = [],
  onReset,
}: SwipeableRowProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startOffset = useRef(0);
  const [snapped, setSnapped] = useState<"left" | "right" | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    startX.current = e.clientX;
    startOffset.current = offset;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [offset]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const delta = e.clientX - startX.current;
    const newOffset = startOffset.current + delta;

    // Clamp to action widths
    const maxRight = rightActions.length * ACTION_WIDTH;
    const maxLeft = leftActions.length * ACTION_WIDTH;
    const clamped = Math.max(-maxLeft, Math.min(maxRight, newOffset));
    setOffset(clamped);
    setSnapped(null);
  }, [dragging, leftActions.length, rightActions.length]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);

    if (offset > THRESHOLD && rightActions.length > 0) {
      // Snap open right
      setOffset(rightActions.length * ACTION_WIDTH);
      setSnapped("right");
    } else if (offset < -THRESHOLD && leftActions.length > 0) {
      // Snap open left
      setOffset(-leftActions.length * ACTION_WIDTH);
      setSnapped("left");
    } else {
      // Snap closed
      setOffset(0);
      setSnapped(null);
    }
  }, [offset, leftActions.length, rightActions.length]);

  const handleClose = useCallback(() => {
    setOffset(0);
    setSnapped(null);
    onReset?.();
  }, [onReset]);

  const isOpen = snapped !== null;
  const maxRight = rightActions.length * ACTION_WIDTH;
  const maxLeft = leftActions.length * ACTION_WIDTH;

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{ touchAction: "pan-y" }}
    >
      {/* Action buttons behind */}
      <div className="absolute inset-0 flex">
        {/* Left actions */}
        <div className="flex shrink-0">
          {leftActions.map((action, i) => (
            <button
              key={i}
              onClick={() => { action.onClick(); handleClose(); }}
              className="flex flex-col items-center justify-center gap-1 text-white text-xs font-semibold transition-opacity"
              style={{
                width: ACTION_WIDTH,
                background: action.color,
                opacity: snapped === "left" ? 1 : 0.5,
              }}
            >
              <span className="text-lg">{action.icon}</span>
              <span className="text-[10px]">{action.label}</span>
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex shrink-0">
          {rightActions.map((action, i) => (
            <button
              key={i}
              onClick={() => { action.onClick(); handleClose(); }}
              className="flex flex-col items-center justify-center gap-1 text-white text-xs font-semibold transition-opacity"
              style={{
                width: ACTION_WIDTH,
                background: action.color,
                opacity: snapped === "right" ? 1 : 0.5,
              }}
            >
              <span className="text-lg">{action.icon}</span>
              <span className="text-[10px]">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content row (slides) */}
      <div
        className="relative z-10 transition-transform"
        style={{
          transform: `translateX(${offset}px)`,
          transitionDuration: dragging ? "0ms" : "250ms",
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
          cursor: dragging ? "grabbing" : "grab",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {children}
      </div>
    </div>
  );
}
