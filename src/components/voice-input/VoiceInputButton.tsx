'use client';

import { Mic, Loader2 } from 'lucide-react';

/**
 * UNAVAILABLE (2026-10-03). This control used to open the microphone, POST the
 * recording to `/api/voice/process`, and render whatever came back. The route's
 * transcription step THREW — "Voice transcription must be implemented client-side
 * using Web Speech API or server-side using Whisper API" — the route caught it
 * and copied the message into its JSON `error`, and this component rendered it
 * verbatim. So every tap on the mic recorded a parent's voice, sent it, and then
 * displayed a developer's TODO.
 *
 * There is no speech-to-text service in this app and no credential for one, so
 * the honest state is a control that says so. Adding a transcription provider is
 * a product decision with a billing consequence, not a UI bug fix — when one
 * exists, delete UNAVAILABLE below and restore the recorder; the module contract
 * is unchanged and already honest (`processVoiceInput` resolves an `unavailable`
 * result instead of throwing).
 *
 * A `disabled` control is dropped from the tab order, so the explanation is
 * rendered as real text and mirrored into the live region — a `title` nobody can
 * reach is not an explanation.
 */
export const VOICE_UNAVAILABLE_REASON =
  "Voice input isn't set up on this dashboard yet — type your message instead.";

interface VoiceInputButtonProps {
  /** Unused while unavailable; kept so enabling the recorder is a one-line diff. */
  onTranscript?: (transcript: string) => void;
  disabled?: boolean;
}

const UNAVAILABLE = true;

export function VoiceInputButton({ disabled }: VoiceInputButtonProps) {
  const stateLabel = 'Voice input is not available';

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => {}}
        disabled={UNAVAILABLE || disabled}
        aria-label={stateLabel}
        title={stateLabel}
        aria-describedby="voice-input-unavailable"
        className="tap-sm flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-3,#3a4256)] cursor-not-allowed opacity-60"
      >
        <Loader2 className="h-6 w-6 text-white/70" aria-hidden="true" />
        <Mic className="h-6 w-6 text-white/70" aria-hidden="true" />
      </button>

      {/* Live region: the state is announced once rather than only hovered. */}
      <span role="status" aria-live="polite" className="sr-only">
        {stateLabel}
      </span>

      <span
        id="voice-input-unavailable"
        className="max-w-[9rem] text-center text-xs text-text-secondary"
      >
        {VOICE_UNAVAILABLE_REASON}
      </span>
    </div>
  );
}