/**
 * Shared client for the streaming Ask Consuela endpoint.
 *
 * SSE protocol (produced by /api/hermes/chat when body.stream === true):
 *   data: {"t":"<delta>"}                          — content token
 *   event: status\ndata: {"label":"<text>"}        — tool activity line
 *   event: error\ndata: {"message":"<text>"}       — terminal failure
 *   data: [DONE]                                   — terminator
 */

export interface StreamConsuelaChatOptions {
  message: string;
  history?: Array<{ role: string; content: string }>;
  agent?: string;
  system?: string;
  /** Resolves early with the partial content when the caller stops generation. */
  signal?: AbortSignal;
  /** Called per token with the full content so far and the new delta. */
  onToken?: (fullContent: string, delta: string) => void;
  /** Called per tool-status event with a friendly label. */
  onStatus?: (label: string) => void;
}

export interface StreamConsuelaChatResult {
  content: string;
  /** false = the route answered buffered (Hermes streaming unavailable). */
  streamed: boolean;
}

export interface SSEFrame {
  event: string;
  data: string;
}

export function parseSSEFrames(buffer: string): { frames: SSEFrame[]; rest: string } {
  const frames: SSEFrame[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length > 0) frames.push({ event, data: dataLines.join("\n") });
  }
  return { frames, rest };
}

export async function streamConsuelaChat(opts: StreamConsuelaChatOptions): Promise<StreamConsuelaChatResult> {
  // Compose the caller's stop signal with the route watchdog: aborting either
  // aborts the fetch; the caller's own signal never leaks the watchdog identity.
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(300_000)])
    : AbortSignal.timeout(300_000);
  let res: Response;
  try {
    res = await fetch("/api/hermes/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Client-side watchdog: the server's 60s per-Hermes-call timeout covers the
      // common hang and always emits a frame; this 5-min cap bounds pre-frame
      // route hangs (e.g. PB auth/config wedged). The longest legitimate flow
      // (trigger_update) restarts the server anyway, which drops the connection
      // regardless.
      signal,
      body: JSON.stringify({
        message: opts.message,
        history: opts.history,
        agent: opts.agent,
        system: opts.system,
        stream: true,
      }),
    });
  } catch (err) {
    // A caller-initiated stop is not an error — it resolves with whatever
    // streamed before the stop, tagged so the caller can label it honestly.
    if (opts.signal?.aborted) {
      const e = new Error("Generation stopped");
      e.name = "AbortError";
      throw e;
    }
    throw err;
  }
  if (!res.ok) throw new Error(`Chat request failed (${res.status})`);

  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("text/event-stream") || !res.body) {
    const data = await res.json();
    const content = String(data.content || data.reply || "");
    // No onToken here: on the buffered path there is nothing to stream, and
    // emitting the whole reply early would let callers render before their
    // thinking-floor/animation beat. The caller sets the final content after
    // the await (gated on `streamed: false`).
    return { content, streamed: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let errorMsg: string | null = null;

  // Race the body reads against the caller's stop signal: some runtimes /
  // proxy streams don't honor the fetch abort on the body, and a blocked
  // read() would leave the stop button hanging. Listeners are cleaned up in
  // the finally below; the swallow-catch keeps a post-loop abort (never
  // raced again) from becoming an unhandled rejection.
  const stopSignal = opts.signal;
  let onAbort: (() => void) | null = null;
  const abortRace = stopSignal
    ? new Promise<never>((_, reject) => {
        onAbort = () => {
          const e = new Error("Generation stopped");
          e.name = "AbortError";
          reject(e);
        };
        if (stopSignal.aborted) onAbort();
        else stopSignal.addEventListener("abort", onAbort, { once: true });
      })
    : null;
  abortRace?.catch(() => {});

  try {
    outer: for (;;) {
      const { done, value } = await (abortRace
        ? Promise.race([reader.read(), abortRace])
        : reader.read());
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSSEFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.event === "status") {
          try {
            const p = JSON.parse(frame.data);
            if (p.label) opts.onStatus?.(String(p.label));
          } catch { /* malformed status frame — ignore */ }
        } else if (frame.event === "error") {
          try {
            const p = JSON.parse(frame.data);
            errorMsg = String(p.message || "Chat failed");
          } catch {
            errorMsg = "Chat failed";
          }
          break outer;
        } else if (frame.data === "[DONE]") {
          break outer;
        } else {
          try {
            const p = JSON.parse(frame.data);
            if (typeof p.t === "string" && p.t.length > 0) {
              content += p.t;
              opts.onToken?.(content, p.t);
            }
          } catch { /* non-JSON data frame — ignore */ }
        }
      }
    }
  } catch (err) {
    if (stopSignal?.aborted) {
      try { await reader.cancel(); } catch { /* body already gone */ }
      const e = new Error("Generation stopped");
      e.name = "AbortError";
      throw e;
    }
    throw err;
  } finally {
    if (stopSignal && onAbort) stopSignal.removeEventListener("abort", onAbort);
  }

  if (errorMsg) throw new Error(errorMsg);
  return { content, streamed: true };
}
