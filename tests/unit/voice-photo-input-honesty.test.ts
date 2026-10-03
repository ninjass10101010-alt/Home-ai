/**
 * Bug 3 (P1) — voice and camera input were 100% broken and leaked internals.
 *
 * `transcribeAudio()` and `extractTextFromImage()` threw unconditionally with
 * developer strings ("Voice transcription must be implemented…", "OCR must be
 * implemented via /api/ocr/extract endpoint"). `processVoiceInput` /
 * `processPhotoInput` caught that and put `error.message` on the result, the
 * routes copied it into their JSON body, and the composer rendered it verbatim —
 * so a parent who tapped the mic saw a developer's TODO.
 *
 * There is NO transcription provider and NO OCR provider configured anywhere in
 * this app: `/api/ocr/extract` is an explicit 501 placeholder and there is no
 * Whisper/Vision key in the environment. Wiring a paid external transcription
 * service is a product decision with a billing consequence, so the honest
 * resolution is UNAVAILABLE — a result that says so, with copy a parent can read,
 * and no fake success.
 *
 * These tests pin the LIB half: no throw, no internal string, an explicit
 * `unavailable` code. The UI half (a disabled control with a real explanation)
 * is `voice-photo-unavailable-ui.test.tsx`.
 */

import { describe, it, expect } from "vitest";
import { processVoiceInput, VOICE_UNAVAILABLE_MESSAGE } from "@/lib/voice-input";
import { processPhotoInput, OCR_UNAVAILABLE_MESSAGE } from "@/lib/photo-input";

/** Anything a user could read on screen. Deliberately broad. */
const INTERNAL_STRINGS = [
  /whisper/i,
  /ocr/i,
  /\/api\//,
  /\bTODO\b/i,
  /implement/i,
  /placeholder/i,
  /web speech/i,
  /transcribe audio/i,
];

function assertNoInternalCopy(message: string) {
  for (const pattern of INTERNAL_STRINGS) {
    expect(message, `"${message}" must not match ${pattern}`).not.toMatch(pattern);
  }
}

const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

describe("Bug 3 — processVoiceInput never throws and never leaks", () => {
  it("resolves (does not reject) for a real audio blob", async () => {
    await expect(processVoiceInput(audio, { familyMembers: [], savedLocations: [] })).resolves.toBeTruthy();
  });

  it("reports an honest, readable unavailability rather than success", async () => {
    const res = await processVoiceInput(audio, { familyMembers: [], savedLocations: [] });
    expect(res.success).toBe(false);
    expect(res.transcript).toBe("");
    expect(res.error).toBe(VOICE_UNAVAILABLE_MESSAGE);
    assertNoInternalCopy(res.error!);
  });

  it("carries a machine code the route and UI can branch on", async () => {
    const res = await processVoiceInput(audio, { familyMembers: [], savedLocations: [] });
    expect(res.code).toBe("unavailable");
  });

  it("never fabricates a transcript, a parsed event, or a clarification", async () => {
    const res = await processVoiceInput(audio, { familyMembers: [], savedLocations: [] });
    expect(res.transcript).toBe("");
    expect(res.parsed).toBeUndefined();
    expect(res.clarification).toBeUndefined();
  });

  it("handles an empty blob without throwing either", async () => {
    const res = await processVoiceInput(new Blob([], { type: "audio/webm" }));
    expect(res.success).toBe(false);
    assertNoInternalCopy(res.error!);
  });
});

describe("Bug 3 — processPhotoInput never throws and never leaks", () => {
  it("resolves (does not reject) for a real image blob", async () => {
    await expect(processPhotoInput(image, { familyMembers: [], savedLocations: [] })).resolves.toBeTruthy();
  });

  it("reports an honest, readable unavailability rather than success", async () => {
    const res = await processPhotoInput(image, { familyMembers: [], savedLocations: [] });
    expect(res.success).toBe(false);
    expect(res.text).toBe("");
    expect(res.error).toBe(OCR_UNAVAILABLE_MESSAGE);
    assertNoInternalCopy(res.error!);
  });

  it("carries a machine code the route and UI can branch on", async () => {
    const res = await processPhotoInput(image, { familyMembers: [], savedLocations: [] });
    expect(res.code).toBe("unavailable");
  });

  it("never fabricates extracted text, a parsed event, or a clarification", async () => {
    const res = await processPhotoInput(image, { familyMembers: [], savedLocations: [] });
    expect(res.text).toBe("");
    expect(res.parsed).toBeUndefined();
    expect(res.clarification).toBeUndefined();
  });

  it("handles an empty blob without throwing either", async () => {
    const res = await processPhotoInput(new Blob([], { type: "image/png" }));
    expect(res.success).toBe(false);
    assertNoInternalCopy(res.error!);
  });
});

describe("Bug 3 — the honest messages are actually honest copy", () => {
  it("each names what is missing and offers the thing the user CAN do", () => {
    for (const message of [VOICE_UNAVAILABLE_MESSAGE, OCR_UNAVAILABLE_MESSAGE]) {
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/type|message|photo|instead/i);
      expect(message.endsWith(".")).toBe(true);
      assertNoInternalCopy(message);
    }
  });

  it("the two messages are distinct — a mic is not a camera", () => {
    expect(VOICE_UNAVAILABLE_MESSAGE).not.toBe(OCR_UNAVAILABLE_MESSAGE);
  });
});