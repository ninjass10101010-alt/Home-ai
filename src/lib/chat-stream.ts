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
  /** Aborts the request when the caller stops generation. */
  signal?: AbortSignal;
  /** Hard cap on the whole exchange, defaults to 5 minutes. */
  watchdogMs?: number;
  /** Called per token with the full content so far and the new delta. */
  onToken?: (fullContent: string, delta: string) => void;
  /** Called per tool-status event with a friendly label and the parsed frame
   *  payload (a propose_point_adjustment status carries `proposal` — the
   *  chat page renders the parent-PIN confirm chip from it). The second
   *  argument is optional, so existing (label) callers keep compiling. */
  onStatus?: (label: string, data?: Record<string, unknown>) => void;
}

export interface StreamConsuelaChatResult {
  content: string;
  /** false = the route answered buffered (Hermes streaming unavailable). */
  streamed: boolean;
  /** Buffered-path sibling of a streamed proposal status frame (Task 15):
   *  inert point-adjustment proposals awaiting a parent's PIN in the UI. */
  proposals?: unknown[];
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

/**
 * The caller's stop and the watchdog are one event once composed into a single
 * signal, so only the caller's own signal can tell them apart — and the
 * distinction is load-bearing: chat-store renders "Stopped." whenever the
 * caller's own controller is aborted (it never reads this error's name), so a
 * watchdog expiry must never be reported as a stop.
 */
function failError(stopSignal: AbortSignal | undefined): Error {
  if (stopSignal?.aborted) {
    const e = new Error("Generation stopped");
    e.name = "AbortError";
    return e;
  }
  return new Error("Chat request timed out");
}

export async function streamConsuelaChat(opts: StreamConsuelaChatOptions): Promise<StreamConsuelaChatResult> {
  const stopSignal = opts.signal;
  // One composed signal for the whole exchange. Both the fetch and every read
  // below race it: some runtimes and proxies don't honor the fetch abort on the
  // body stream, so bounding only the fetch leaves a wedged read bouncing the
  // typing dots with no honest error. The caller's signal never leaks the
  // watchdog's identity into the request.
  const failSignal = AbortSignal.any([
    ...(stopSignal ? [stopSignal] : []),
    AbortSignal.timeout(opts.watchdogMs ?? 300_000),
  ]);
  let res: Response;
  try {
    res = await fetch("/api/hermes/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Client-side watchdog: the server's 60s per-Hermes-call timeout covers the
      // common hang and always emits a frame; this cap bounds the whole exchange
      // — pre-frame route hangs and wedged body reads (e.g. PB auth/config
      // wedged). The longest legitimate flow (trigger_update) restarts the server
      // anyway, which drops the connection regardless.
      signal: failSignal,
      body: JSON.stringify({
        message: opts.message,
        history: opts.history,
        agent: opts.agent,
        system: opts.system,
        stream: true,
      }),
    });
  } catch (err) {
    if (failSignal.aborted) throw failError(stopSignal);
    throw err;
  }
  if (!res.ok) throw new Error(`Chat request failed (${res.status})`);

  // The single listener raced against every await that can wedge: the buffered
  // res.json() and each body read. The swallow-catch keeps a post-return abort
  // (never raced again) from becoming an unhandled rejection; the listener is
  // detached in the finally below.
  let onFail: (() => void) | null = null;
  const failRace = new Promise<never>((_, reject) => {
    onFail = () => reject(failError(stopSignal));
    if (failSignal.aborted) onFail();
    else failSignal.addEventListener("abort", onFail, { once: true });
  });
  failRace.catch(() => {});

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("text/event-stream") || !res.body) {
      const data = await Promise.race([res.json(), failRace]);
      const content = String(data.content || data.reply || "");
      // No onToken here: on the buffered path there is nothing to stream, and
      // emitting the whole reply early would let callers render before their
      // thinking-floor/animation beat. The caller sets the final content after
      // the await (gated on `streamed: false`).
      return {
        content,
        streamed: false,
        proposals: Array.isArray(data.proposals) ? data.proposals : undefined,
      };
    }

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let errorMsg: string | null = null;

    outer: for (;;) {
      const { done, value } = await Promise.race([reader.read(), failRace]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSSEFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.event === "status") {
          try {
            const p = JSON.parse(frame.data);
            if (p.label) opts.onStatus?.(String(p.label), p);
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

    if (errorMsg) throw new Error(errorMsg);
    return { content, streamed: true };
  } catch (err) {
    if (failSignal.aborted) {
      // Best-effort release of the reader we hold, deliberately NOT awaited: on
      // a runtime that doesn't honor the fetch abort on the body — the case
      // this watchdog exists for — a stalled cancel would delay the honest
      // stop/timeout error and re-introduce the very hang we're ending. The
      // buffered path has no reader to release (res.json() was evaluated as the
      // race argument and already locked res.body), so there the socket is left
      // to the fetch's own abort of failSignal, where the runtime honors it.
      if (reader) void reader.cancel().catch(() => { /* body already gone */ });
      throw failError(stopSignal);
    }
    throw err;
  } finally {
    if (onFail) failSignal.removeEventListener("abort", onFail);
  }
}
