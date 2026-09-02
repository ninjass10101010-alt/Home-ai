"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const CROP_OUTPUT_SIZE = 256;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

// Cover scale: how much the image must be scaled so it always covers the square
// viewport (no letterboxing) at zoom = 1.
export function coverScale(imgW: number, imgH: number, view: number) {
  if (imgW <= 0 || imgH <= 0 || view <= 0) return 1;
  return Math.max(view / imgW, view / imgH);
}

// Clamp a pan so the image never leaves a gap inside the viewport.
export function clampPan(tx: number, ty: number, imgW: number, imgH: number, view: number, zoom: number) {
  const cover = coverScale(imgW, imgH, view);
  const W = imgW * cover * zoom;
  const H = imgH * cover * zoom;
  const maxX = Math.max(0, (W - view) / 2);
  const maxY = Math.max(0, (H - view) / 2);
  return {
    tx: Math.min(maxX, Math.max(-maxX, tx)),
    ty: Math.min(maxY, Math.max(-maxY, ty)),
  };
}

// Map the visible viewport back to a source rectangle in the original image.
export function getCropSourceRect(imgW: number, imgH: number, view: number, tx: number, ty: number, zoom: number) {
  const cover = coverScale(imgW, imgH, view);
  const s = cover * zoom;
  const left = (view - imgW * s) / 2 + tx;
  const top = (view - imgH * s) / 2 + ty;
  const src = view / s;
  return {
    sx: -left / s,
    sy: -top / s,
    src,
  };
}

// Produce the final 256×256 square WebP data URL from the visible region.
export function cropToDataUrl(img: HTMLImageElement, view: number, tx: number, ty: number, zoom: number): string {
  const { sx, sy, src } = getCropSourceRect(img.naturalWidth, img.naturalHeight, view, tx, ty, zoom);
  const canvas = document.createElement("canvas");
  canvas.width = CROP_OUTPUT_SIZE;
  canvas.height = CROP_OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop that photo.");
  ctx.drawImage(img, sx, sy, src, src, 0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
  const dataUrl = canvas.toDataURL("image/webp", 0.85);
  if (dataUrl === "data:,") throw new Error("Could not crop that photo.");
  return dataUrl;
}

interface PhotoCropEditorProps {
  src: string;
  onApply: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

export default function PhotoCropEditor({ src, onApply, onCancel }: PhotoCropEditorProps) {
  const [view, setView] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [imgDims, setImgDims] = useState({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ tx: 0, ty: 0 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ lastX: number; lastY: number; pointers: Map<number, { x: number; y: number }>; pinchStart?: { d: number; zoom: number } }>({
    lastX: 0,
    lastY: 0,
    pointers: new Map(),
  });

  // Measure the viewport (square) on mount and on resize.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Body scroll lock + Escape to cancel.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  const applyZoom = useCallback((nextZoom: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    setZoom(z);
    setPan((prev) => clampPan(prev.tx, prev.ty, imgDims.w, imgDims.h, view, z));
  }, [imgDims, view]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = dragRef.current;
    p.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (p.pointers.size === 2) {
      const [a, b] = [...p.pointers.values()];
      p.pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
    p.lastX = e.clientX;
    p.lastY = e.clientY;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = dragRef.current;
    if (!p.pointers.has(e.pointerId)) return;
    p.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (p.pointers.size === 2 && p.pinchStart) {
      const [a, b] = [...p.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.pinchStart.zoom * (d / Math.max(1, p.pinchStart.d))));
      // Pan along with the pinch midpoint movement.
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      setZoom(z);
      setPan((prev) => clampPan(prev.tx + (midX - p.lastX), prev.ty + (midY - p.lastY), imgDims.w, imgDims.h, view, z));
      p.lastX = midX;
      p.lastY = midY;
      return;
    }

    const dx = e.clientX - p.lastX;
    const dy = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    if (p.pointers.size === 1) {
      setPan((prev) => clampPan(prev.tx + dx, prev.ty + dy, imgDims.w, imgDims.h, view, zoom));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = dragRef.current;
    p.pointers.delete(e.pointerId);
    if (p.pointers.size < 2) p.pinchStart = undefined;
  };

  // Non-passive wheel so we can preventDefault the page scroll while zooming.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      setZoom(z);
      setPan((p) => clampPan(p.tx, p.ty, imgDims.w, imgDims.h, view, z));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [imgDims, view, zoom]);

  const handleImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
    setLoaded(true);
  };

  const handleApply = () => {
    const img = imgRef.current;
    if (!img || !loaded || view <= 0) return;
    try {
      onApply(cropToDataUrl(img, view, pan.tx, pan.ty, zoom));
    } catch (err) {
      onCancel();
    }
  };

  const cover = coverScale(imgDims.w, imgDims.h, view);
  const scale = cover * zoom;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/70 backdrop-blur-sm"
      style={{ animation: "consuela-fade-in .2s ease both" }}
    >
      <div className="flex flex-1 items-center justify-center px-6 pt-6">
        <div className="w-full max-w-[420px]">
          <div className="mb-4 text-center">
            <h3 className="text-lg font-bold text-text-primary">Reposition photo</h3>
            <p className="mt-1 text-sm text-text-secondary">Drag to move · scroll or pinch to zoom</p>
          </div>

          <div
            ref={viewportRef}
            className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-3xl border border-white/15 bg-[var(--color-surface-2)]"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              className="absolute left-1/2 top-1/2 will-change-transform"
              style={{
                width: imgDims.w,
                height: imgDims.h,
                marginLeft: -imgDims.w / 2,
                marginTop: -imgDims.h / 2,
                transform: `translate(${pan.tx}px, ${pan.ty}px) scale(${scale})`,
              }}
            >
              <img
                ref={imgRef}
                src={src}
                alt="Profile photo"
                draggable={false}
                className="block h-full w-full select-none"
                onLoad={handleImageLoad}
              />
            </div>

            {!loaded && <div className="absolute inset-0 grid place-items-center text-sm text-text-muted">Loading photo…</div>}
          </div>
        </div>
      </div>

      <div className="px-6 pb-safe pt-5">
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-3 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => applyZoom(zoom / 1.2)}
              aria-label="Zoom out"
              className="tap-sm grid h-11 w-11 place-items-center rounded-full border border-white/12 bg-white/10 text-lg text-white"
            >
              −
            </button>
            <span className="w-12 text-center text-sm tabular-nums text-text-secondary">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => applyZoom(zoom * 1.2)}
              aria-label="Zoom in"
              className="tap-sm grid h-11 w-11 place-items-center rounded-full border border-white/12 bg-white/10 text-lg text-white"
            >
              +
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="tap-sm flex-1 rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-sm font-semibold text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!loaded || view <= 0}
              className="tap-sm flex-1 rounded-2xl bg-[var(--color-accent-button)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
