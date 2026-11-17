import { getHAConfig } from "./config";
import { spawn } from "child_process";

export function cleanTextForTTS(raw: string): string {
  if (!raw) return "";

  let text = raw;
  // Remove markdown code blocks
  text = text.replace(/```[\s\S]*?```/g, "");
  // Remove inline code
  text = text.replace(/`([^`]+)`/g, "$1");
  // Remove links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Remove bold / italics
  text = text.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");
  // Remove headers
  text = text.replace(/^#{1,6}\s+/gm, "");
  // Remove bullet points / blockquotes
  text = text.replace(/^[\s>*-]+\s+/gm, "");
  // Remove emojis
  text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  // If text is very long, take the first 300 characters / first sentence or two
  if (text.length > 350) {
    const endOfSentence = text.indexOf(".", 200);
    if (endOfSentence !== -1 && endOfSentence < 400) {
      text = text.slice(0, endOfSentence + 1);
    } else {
      text = text.slice(0, 350).trim() + "…";
    }
  }

  return text;
}

/**
 * Synthesize speech from text using Home Assistant Piper TTS.
 * Returns the proxy URL that clients on the LAN can stream directly.
 */
export async function haSynthesize(text: string): Promise<{ url: string; path: string }> {
  const cfg = await getHAConfig();
  const cleaned = cleanTextForTTS(text);
  if (!cleaned) {
    throw new Error("No speakable text provided");
  }

  const res = await fetch(`${cfg.haHost}/api/tts_get_url`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.haToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      platform: "tts.piper",
      message: cleaned,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HA Piper TTS failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { url?: string; path?: string };
  if (!data.url && !data.path) {
    throw new Error("Invalid response from HA Piper TTS");
  }

  let finalUrl = data.url || `${cfg.haHost}${data.path}`;
  // Ensure finalUrl is absolute with haHost if needed
  if (finalUrl.startsWith("/")) {
    finalUrl = `${cfg.haHost}${finalUrl}`;
  }

  return {
    url: finalUrl,
    path: data.path || new URL(finalUrl).pathname,
  };
}

/**
 * Converts audio buffer to 16kHz mono 16-bit PCM WAV using ffmpeg if needed.
 */
async function ensureWav16k(audioBuffer: Buffer): Promise<Buffer> {
  // Check if already WAV
  if (audioBuffer.length >= 12 && audioBuffer.subarray(0, 4).toString() === "RIFF" && audioBuffer.subarray(8, 12).toString() === "WAVE") {
    return audioBuffer;
  }

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i", "pipe:0",
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      "-f", "wav",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const errMsg = Buffer.concat(errChunks).toString("utf8");
        reject(new Error(`ffmpeg audio conversion failed (code ${code}): ${errMsg}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}. Ensure input is WAV or install ffmpeg.`));
    });

    proc.stdin.write(audioBuffer);
    proc.stdin.end();
  });
}

/**
 * Transcribes audio using Home Assistant Faster Whisper STT.
 */
export async function haTranscribe(audioBuffer: Buffer): Promise<{ text: string }> {
  const cfg = await getHAConfig();
  const wavBuffer = await ensureWav16k(audioBuffer);

  const res = await fetch(`${cfg.haHost}/api/stt/stt.faster_whisper`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.haToken}`,
      "X-Speech-Content": "format=wav; codec=pcm; sample_rate=16000; bit_rate=16; channel=1; language=en",
      "Content-Type": "audio/wav",
    },
    body: wavBuffer as any,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HA Whisper STT failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { text?: string; result?: string };
  return {
    text: (data.text || "").trim(),
  };
}
