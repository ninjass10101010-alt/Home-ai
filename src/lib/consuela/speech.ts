/**
 * Tiny speechSynthesis wrapper for the chat orb's read-aloud (pre-readers on
 * the kitchen phone). Guarded for browsers without speech synthesis; never
 * throws. The last spoken text is kept so the page can re-offer it.
 */

export const lastSpokenRef = { current: null as string | null };

export function isSpeechSupported(): boolean {
  const synth = typeof globalThis !== "undefined" ? (globalThis as any).speechSynthesis : undefined;
  return typeof synth?.speak === "function";
}

export function speak(text: string): void {
  if (!isSpeechSupported()) return;
  const synth = (globalThis as any).speechSynthesis;
  const clean = text.trim();
  if (!clean) return;
  try {
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1;
    utter.lang = "en-US";
    synth.speak(utter);
    lastSpokenRef.current = clean;
  } catch {
    /* speech unavailable mid-call — stay silent, never crash the chat */
  }
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return;
  try {
    (globalThis as any).speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

export function isSpeaking(): boolean {
  if (!isSpeechSupported()) return false;
  try {
    return (globalThis as any).speechSynthesis.speaking;
  } catch {
    return false;
  }
}
