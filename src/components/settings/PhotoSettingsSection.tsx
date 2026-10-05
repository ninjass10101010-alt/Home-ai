"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import Chip from "@/components/ui/Chip";
import SegmentedControl from "@/components/ui/SegmentedControl";
import SoftButton from "@/components/ui/SoftButton";
import Toast from "@/components/ui/Toast";
import Toggle from "@/components/ui/Toggle";
import { usePrefersReducedMotion } from "@/hooks/useReducedMotionPreference";
import { useSettingsFeedback } from "@/hooks/useSettingsFeedback";
import {
  PHOTO_SETTINGS_DEFAULTS,
  ROTATE_MAX_S,
  ROTATE_MIN_S,
  formatRotateLabel,
  normalizePhotoSettings,
  type PhotoOrder,
  type PhotoSettings,
  type PhotoTransition,
} from "@/lib/photos/settings";

/**
 * Photo widget settings — the family-facing form (spec §5).
 *
 * The erase-guard is the whole point of this component (spec §5.1): every
 * control stays disabled until the initial GET settles, a `degraded` read
 * keeps it disabled forever (a failed read must never become a write), and
 * PATCHes carry ONLY the fields that changed — the reset button is the single,
 * explicit full-body write. The one exception to "no writes while degraded" is
 * enforced twice: handlers check `disabled`, and `patchSettings` checks
 * `degradedRef` so no code path can slip a request through.
 */

const SETTINGS_URL = "/api/photos/settings";

const ROTATE_PRESETS = [
  { seconds: 30, label: "Fast 30s" },
  { seconds: 75, label: "Normal 75s" },
  { seconds: 300, label: "Slow 5min" },
] as const;

const TRANSITION_OPTIONS = [
  { id: "crossfade", label: "Crossfade" },
  { id: "dissolve", label: "Dissolve" },
  { id: "slide", label: "Slide" },
  { id: "cut", label: "Cut" },
] as const;

const ORDER_OPTIONS = [
  { id: "shuffle", label: "Shuffle" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
] as const;

/** One drag of the slider is one request, not two hundred (spec §5.1). */
const ROTATE_DEBOUNCE_MS = 400;

interface SettingsBody {
  ok?: boolean;
  settings?: unknown;
  degraded?: boolean;
  error?: string;
}

export default function PhotoSettingsSection() {
  const { feedback, showFeedback } = useSettingsFeedback();
  const reducedMotion = usePrefersReducedMotion();

  /** What the controls show — optimistic on edits, server truth on adopt. */
  const [view, setView] = useState<PhotoSettings>(PHOTO_SETTINGS_DEFAULTS);
  /** Last settings the server confirmed. `null` until the first GET settles. */
  const [server, setServer] = useState<PhotoSettings | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const serverRef = useRef<PhotoSettings | null>(null);
  /**
   * Write guard for `patchSettings`, set in the mount fetch callback (never
   * during render). A degraded read must never become a write (spec §5.1), and
   * a ref set alongside the state flip cannot be stale the way a render-time
   * ref assignment or a not-yet-flushed effect would be.
   */
  const degradedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRotateRef = useRef<number | null>(null);

  const disabled = server === null || degraded;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(SETTINGS_URL);
        const body = (await res.json().catch(() => null)) as SettingsBody | null;
        if (cancelled) return;
        if (res.ok && body?.ok === true) {
          const truth = normalizePhotoSettings(body.settings);
          serverRef.current = truth;
          setServer(truth);
          setView(truth);
          // A degraded read still lands as server truth (defaults), but the
          // card stays disabled — see the `disabled` expression above.
          const isDegraded = body.degraded === true;
          degradedRef.current = isDegraded;
          setDegraded(isDegraded);
        } else {
          degradedRef.current = true;
          setDegraded(true);
        }
      } catch {
        if (!cancelled) {
          degradedRef.current = true;
          setDegraded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const clearRotateDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingRotateRef.current = null;
  }, []);

  /**
   * Subset-only write (spec §5.1): `subset` carries the changed field(s) and
   * nothing else — reset is the only caller that passes all four. Success
   * adopts the server's normalized response as the new truth; failure rolls
   * the control back to the last confirmed value and toasts honestly.
   */
  const patchSettings = useCallback(
    async (subset: Partial<PhotoSettings>) => {
      if (degradedRef.current || !serverRef.current) return;
      try {
        const res = await fetch(SETTINGS_URL, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subset),
        });
        const body = (await res.json().catch(() => null)) as SettingsBody | null;
        if (res.ok && body?.ok === true && serverRef.current) {
          const truth = normalizePhotoSettings(body.settings);
          serverRef.current = truth;
          setServer(truth);
          setView(truth);
        } else if (serverRef.current) {
          setView(serverRef.current);
          showFeedback("Couldn't save photo settings", "error");
        }
      } catch {
        if (serverRef.current) setView(serverRef.current);
        showFeedback("Couldn't save photo settings", "error");
      }
    },
    [showFeedback],
  );

  const commitRotate = (seconds: number) => {
    if (disabled) return;
    clearRotateDebounce();
    setView((current) => ({ ...current, rotateSeconds: seconds }));
    void patchSettings({ rotateSeconds: seconds });
  };

  const handleRotateInput = (raw: number) => {
    if (disabled) return;
    const next = Math.min(ROTATE_MAX_S, Math.max(ROTATE_MIN_S, raw));
    pendingRotateRef.current = next;
    setView((current) => ({ ...current, rotateSeconds: next }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const seconds = pendingRotateRef.current;
      pendingRotateRef.current = null;
      if (seconds === null) return;
      void patchSettings({ rotateSeconds: seconds });
    }, ROTATE_DEBOUNCE_MS);
  };

  const handleTransition = (value: string) => {
    if (disabled) return;
    const transition = value as PhotoTransition;
    setView((current) => ({ ...current, transition }));
    void patchSettings({ transition });
  };

  const handleOrder = (value: string) => {
    if (disabled) return;
    const order = value as PhotoOrder;
    setView((current) => ({ ...current, order }));
    void patchSettings({ order });
  };

  const handleCaption = (checked: boolean) => {
    if (disabled) return;
    setView((current) => ({ ...current, showCaption: checked }));
    void patchSettings({ showCaption: checked });
  };

  const confirmReset = () => {
    setResetOpen(false);
    if (disabled) return;
    clearRotateDebounce();
    setView(PHOTO_SETTINGS_DEFAULTS);
    // The one allowed full-body write (spec §5.1).
    void patchSettings({ ...PHOTO_SETTINGS_DEFAULTS });
  };

  const segmentWrapClass = disabled ? "pointer-events-none opacity-50" : "";

  return (
    <SectionCard
      title="Photos"
      description="Tune how family photos change on the wall."
      icon="🖼️"
      headingLevel="h2"
    >
      <Toast open={feedback !== null} tone={feedback?.tone}>
        {feedback?.message}
      </Toast>
      <div className="space-y-4">
        {degraded ? (
          <p className="text-xs text-text-muted">Couldn&apos;t read saved settings — showing defaults.</p>
        ) : null}

        <div>
          <label
            htmlFor="photo-rotate-seconds"
            className="mb-2 block min-h-[44px] text-xs font-semibold text-text-secondary"
          >
            Seconds per photo — {formatRotateLabel(view.rotateSeconds)}
          </label>
          <div className="mb-2 flex flex-wrap gap-2">
            {ROTATE_PRESETS.map((preset) => (
              <Chip
                key={preset.seconds}
                selected={view.rotateSeconds === preset.seconds}
                disabled={disabled}
                onClick={() => commitRotate(preset.seconds)}
              >
                {preset.label}
              </Chip>
            ))}
          </div>
          <input
            id="photo-rotate-seconds"
            type="range"
            min={ROTATE_MIN_S}
            max={ROTATE_MAX_S}
            step={5}
            value={view.rotateSeconds}
            disabled={disabled}
            onChange={(event) => handleRotateInput(Number(event.target.value))}
            className="min-h-[44px] w-full min-w-0 cursor-pointer appearance-none rounded-full bg-[var(--color-surface-3)] accent-[var(--color-accent-selected)] disabled:opacity-50"
          />
          <div className="mt-1 flex justify-between text-xs text-text-muted">
            <span>{formatRotateLabel(ROTATE_MIN_S)}</span>
            <span>{formatRotateLabel(ROTATE_MAX_S)}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-text-secondary">Transition</p>
          <div aria-disabled={disabled || undefined} className={segmentWrapClass}>
            <SegmentedControl
              options={TRANSITION_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
              value={view.transition}
              onChange={handleTransition}
              aria-label="Photo transition"
            />
          </div>
          {reducedMotion ? (
            <p className="mt-2 text-xs text-text-muted">
              Your device asks for reduced motion, so photos change with a hard cut regardless.
            </p>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-text-secondary">Order</p>
          <div aria-disabled={disabled || undefined} className={segmentWrapClass}>
            <SegmentedControl
              options={ORDER_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
              value={view.order}
              onChange={handleOrder}
              aria-label="Photo order"
            />
          </div>
        </div>

        <Toggle
          checked={view.showCaption}
          onCheckedChange={handleCaption}
          disabled={disabled}
          label="Caption"
          description="Show each photo's caption on the wall."
        />

        <SoftButton variant="secondary" disabled={disabled} onClick={() => setResetOpen(true)} className="w-full">
          Reset
        </SoftButton>
      </div>

      <SettingsConfirmDialog
        open={resetOpen}
        title="Reset photo settings?"
        description="Restore the default delay, transition, order, and caption."
        confirmLabel="Reset"
        busy={false}
        onConfirm={confirmReset}
        onClose={() => setResetOpen(false)}
      >
        <p className="text-sm text-text-secondary">
          Seconds per photo, transition, order, and caption return to their defaults on every device.
        </p>
      </SettingsConfirmDialog>
    </SectionCard>
  );
}
