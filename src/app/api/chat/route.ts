import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const GATEWAY_URL = process.env.OPENCLAW_WS_URL || "ws://openclaw:18789";
const GATEWAY_TOKEN = process.env.OPENCLAW_TOKEN || "openclaw-key-998877";
const AGENT_ID = "consuela";
const SESSION_ID = "family-dashboard";
const TIMEOUT_MS = 60_000;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "Empty message" }, { status: 400 });
    }

    const reply = await sendToOpenClaw(message.trim());
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Chat proxy error:", err);
    return NextResponse.json(
      { error: "Failed to reach Consuela", details: String(err) },
      { status: 502 }
    );
  }
}

function sendToOpenClaw(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    import("ws")
      .then(({ default: WebSocket }) => {
        const ws = new WebSocket(GATEWAY_URL);
        let settled = false;
        let fullReply = "";

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            ws.close();
            if (fullReply) resolve(fullReply);
            else reject(new Error("Timeout waiting for response"));
          }
        }, TIMEOUT_MS);

        ws.on("open", () => {
          // OpenClaw V3 Protocol uses Req/Res frames
          ws.send(JSON.stringify({
            type: "req",
            id: randomUUID(),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: { id: "gateway-client", version: "1.0.0", platform: "linux", mode: "backend" },
              auth: { token: GATEWAY_TOKEN },
              role: "operator",
              scopes: ["operator.admin"]
            }
          }));
        });

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());

            // 1. Handle Connection Success
            if (msg.type === "res" && msg.ok && msg.payload?.type === "hello-ok") {
              ws.send(JSON.stringify({
                type: "req",
                id: randomUUID(),
                method: "agent",
                params: {
                  agentId: AGENT_ID,
                  message: message,
                  sessionId: SESSION_ID,
                  idempotencyKey: randomUUID()
                }
              }));
            }

            // 2. Handle Errors
            if (msg.error) {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                ws.close();
                reject(new Error(msg.error.message || "Gateway error"));
              }
              return;
            }

            // 3. Collect Text Stream
            if (msg.type === "event" && msg.event === "agent" && msg.payload?.stream === "text") {
              // Accumulate total text from the latest payload
              if (msg.payload.data?.text) {
                fullReply = msg.payload.data.text;
              }
            }

            // 4. Detect Turn Completion
            if (msg.type === "event" && msg.event === "chat" && msg.payload?.state === "turn:complete") {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                ws.close();
                resolve(fullReply || "Message processed!");
              }
            }
          } catch (e) {
            // Ignore non-JSON
          }
        });

        ws.on("error", (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error("WebSocket error: " + err.message));
          }
        });

        ws.on("close", () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            if (fullReply) resolve(fullReply);
            else reject(new Error("Connection closed early"));
          }
        });
      })
      .catch(reject);
  });
}
