'use client';

import { useState, useRef } from 'react';
import { Camera, X } from 'lucide-react';

/**
 * UNAVAILABLE (2026-10-03). This control used to open the file picker, POST the
 * image to `/api/photo/process`, and render whatever came back. The route's OCR
 * step THREW — "OCR must be implemented via /api/ocr/extract endpoint" — the
 * route copied the message into its JSON `error`, and this component rendered it
 * verbatim, so a parent who took a photo of a flyer was shown a developer's TODO.
 *
 * There is no OCR service in this app: `/api/ocr/extract` is a documented 501
 * placeholder and no OCR credential exists in the environment. The honest state
 * is therefore a control that says so, and a file input that cannot be driven —
 * the PREVIEW branch is retained (below) purely so the 24px remove button's
 * documented 44px hit-area allowlist entry in
 * `tests/unit/tap-target-contract.test.ts` stays valid; it is unreachable while
 * UNAVAILABLE is true.
 */
export const PHOTO_UNAVAILABLE_REASON =
  "Reading photos isn't set up on this dashboard yet — type or paste it instead.";

interface PhotoInputButtonProps {
  /** Unused while unavailable; kept so enabling OCR is a one-line diff. */
  onExtracted?: (text: string) => void;
  disabled?: boolean;
}

const UNAVAILABLE = true;

export function PhotoInputButton({ disabled }: PhotoInputButtonProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearPreview = () => {
    setPreview(null);
  };

  const stateLabel = 'Photo text reading is not available';

  return (
    <div className="flex flex-col items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={UNAVAILABLE || disabled}
        aria-label="Photo to extract text from"
        className="hidden"
      />

      <button
        type="button"
        onClick={() => {}}
        disabled={UNAVAILABLE || disabled}
        aria-label="Take photo or upload image"
        title={stateLabel}
        aria-describedby="photo-input-unavailable"
        className="tap-sm flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-3,#3a4256)] cursor-not-allowed opacity-60"
      >
        <Camera className="h-6 w-6 text-white/70" aria-hidden="true" />
      </button>

      {/* Live region: the state is announced once rather than only hovered. */}
      <span role="status" aria-live="polite" className="sr-only">
        {stateLabel}
      </span>

      <span
        id="photo-input-unavailable"
        className="max-w-[9rem] text-center text-xs text-text-secondary"
      >
        {PHOTO_UNAVAILABLE_REASON}
      </span>

      {/* Unreachable while UNAVAILABLE — see the file note. */}
      {preview && (
        <div className="relative mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data-URL preview */}
          <img
            src={preview}
            alt="Photo preview before sending"
            className="h-24 w-24 object-cover rounded-lg border border-white/10"
          />
          <button
            onClick={clearPreview}
            aria-label="Remove photo"
            title="Remove photo"
            className="tap-sm absolute -top-2 -right-2 h-6 w-6 rounded-full bg-[var(--color-accent-rose)] flex items-center justify-center before:absolute before:-inset-2.5 before:content-['']"
          >
            <X className="h-4 w-4 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}