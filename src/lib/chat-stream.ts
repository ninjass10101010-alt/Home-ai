/**
 * Shared client for the streaming Ask Consuela endpoint.
 *
 * SSE protocol (produced by /api/hermes/chat when body.stream === true):
 *   event: attempt\ndata: {"round":N,"target":"tN"} — new provider call;
 *   "exhausted" (not a chain index) marks the       — earlier tokens are
 *   synthesized fallback answer                     — superseded
 *   data: {"t":"<delta>"}                           — content token
 *   event: reasoning\ndata: {"r":"<delta>"}          — model's reasoning
 *   event: tool\ndata: {"name","state"}            — tool activity chip,
 *   "state" is "running" | "ok" | "error"             one per call, `running`
 *                                                    emitted before any call runs
 *   event: status\ndata: {"label":"<text>"}         — tool activity line
 *   event: error\ndata: {"message":"<text>"}        — terminal failure
 *   data: [DONE]                                    — terminator
 *
 * `reasoning` and `tool` are DISPLAY-ONLY (spec §8): unlike `t` they never
 * belong to the answer, so nothing derived from them may be persisted or sent
 * back as history. They are also distinct from `attempt`, which is the only
 * frame that resets what the user is looking at.
 */

/**
 * The three states the route emits. `error` means the tool RESULT carried an
 * `error` field, which is broader than a failure — the live registry answers
 * several routine refusals that way ("Already completed — waiting for parent
 * approval", "task is already pending") — so a caller must not render this
 * state as a crash. Nothing on the wire separates the two cases.
 */
export type ToolEventState = "running" | "ok" | "error";

export interface ToolEvent {
  name: string;
  state: ToolEventState;
}

const TOOL_EVENT_STATES: readonly string[] = ["running", "ok", "error"];

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
  /** Called per reasoning delta with the transcript so far and the new delta.
   *  Resets alongside the content accumulator on an `attempt` frame. */
  onReasoning?: (fullReasoning: string, delta: string) => void;
  /** Called per tool-activity frame: one `running` per announced call, then one
   *  result frame per call in call order. */
  onToolEvent?: (ev: ToolEvent) => void;
  /** Called with a friendly label and the parsed frame payload (a
   *  propose_point_adjustment or propose_reward_redemption status carries
   *  `proposal` — the chat page renders the PIN-confirm chip from it). The
   *  second argument is optional, so existing (label) callers keep compiling. */
  onStatus?: (label: string, data?: Record<string, unknown>) => void;
  /** Called when the route announces a new (round × target) provider call. The
   *  tokens received so far are superseded — the accumulator has been reset, so
   *  the next `onToken` reports only the new attempt's content. */
  onAttempt?: (meta: { round: number; target: string }) => void;
}

export interface StreamConsuelaChatResult {
  content: string;
  /** false = the route answered buffered (Hermes streaming unavailable). */
  streamed: boolean;
  /** Buffered-path sibling of a streamed proposal status frame (Tasks 15 + 14):
   *  inert point-adjustment and reward-redemption proposals awaiting a PIN in
   *  the UI. */
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
 * The route's own terminal failure — it reached the model layer and answered
 * with something specific ("My brain isn't configured yet — add a provider in
 * Settings → AI Models.", "I hit a snag doing that"). chat-store renders this
 * message verbatim; covering it with offline copy would replace an actionable
 * sentence with a useless one.
 *
 * Discriminated by `name`, never by `instanceof`: chat-store's suite mocks this
 * whole module, and any future serialization boundary would break the
 * prototype chain while preserving the name.
 */
export class RouteChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteChatError";
  }
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
      // Client-side watchdog: the server's per-Hermes-call timeout covers the
      // common hang and always emits a frame (60s on the buffered/planner calls,
      // 120s on the streamed one the UI always uses); this cap bounds what that
      // per-call timeout does not — pre-frame route hangs and wedged body reads
      // (e.g. PB auth/config wedged). The longest legitimate flow (trigger_update)
      // restarts the server anyway, which drops the connection regardless.
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
    let reasoning = "";
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
            errorMsg = typeof p.message === "string" && p.message.trim() ? p.message : "Chat failed";
          } catch {
            errorMsg = "Chat failed";
          }
          break outer;
        } else if (frame.data === "[DONE]") {
          break outer;
        } else if (frame.event === "attempt") {
          // The route persists ONLY the answering round, so this attempt's tokens
          // replace the previous one's rather than continuing them. Resetting
          // here is what keeps displayed === finalContent === persisted on the
          // preamble round, the mid-round target failover and the exhaustion
          // fallback alike. The reset stands even if the payload is malformed:
          // leaving a superseded attempt's tokens on screen is the worse failure.
          content = "";
          // The think resets with the tokens, and has to: the route's
          // `reasoningAnnounced` / `reasoningChars` are function-local to
          // callAiStream, so no cross-attempt transcript exists server-side and
          // nothing downstream can drop a superseded one. The exhaustion
          // fallback is the concrete case — six rounds of thinking would
          // otherwise render as the fallback answer's own.
          reasoning = "";
          try {
            const p = JSON.parse(frame.data);
            opts.onAttempt?.({ round: Number(p.round) || 0, target: String(p.target || "") });
          } catch { /* malformed attempt frame — the resets above still stand */ }
        } else if (frame.event === "reasoning") {
          // Unlike `attempt`, the reset is NOT the point here — the accumulated
          // transcript is — so a frame that does not parse adds nothing and
          // takes nothing away. Dropping the transcript on a bad frame would
          // blank what the user is reading mid-think.
          try {
            const p = JSON.parse(frame.data);
            if (typeof p.r === "string" && p.r.length > 0) {
              reasoning += p.r;
              opts.onReasoning?.(reasoning, p.r);
            }
          } catch { /* malformed reasoning frame — ignore */ }
        } else if (frame.event === "tool") {
          // State is validated, not passed through: the payload is parsed off the
          // wire, and an unrecognized state would reach a chip with no glyph for
          // it. `error` itself is passed verbatim — see ToolEventState.
          try {
            const p = JSON.parse(frame.data);
            if (typeof p.name === "string" && typeof p.state === "string" && TOOL_EVENT_STATES.includes(p.state)) {
              opts.onToolEvent?.({ name: p.name, state: p.state as ToolEventState });
            }
          } catch { /* malformed tool frame — ignore */ }
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

    if (errorMsg) throw new RouteChatError(errorMsg);
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
