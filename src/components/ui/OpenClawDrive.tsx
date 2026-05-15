"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OpenClawDrive() {
  const router = useRouter();

  useEffect(() => {
    const bridgeUrl = process.env.NEXT_PUBLIC_OPENCLAW_BRIDGE_URL || "ws://localhost:3005";
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;

    const connect = () => {
      console.log("Connecting to OpenClaw Drive bridge...");
      ws = new WebSocket(bridgeUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received drive command:", data);

          if (data.action === "navigate" && data.path) {
            router.push(data.path);
          }
          
          if (data.action === "alert" && data.message) {
            alert(data.message);
          }
        } catch (e) {
          console.error("Failed to parse drive command:", e);
        }
      };

      ws.onclose = () => {
        console.log("Drive bridge disconnected, retrying in 5s...");
        reconnectTimer = setTimeout(connect, 5000);
      };

      ws.onerror = (e) => {
        console.error("Drive bridge error:", e);
        ws?.close();
      };
    };

    connect();

    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, [router]);

  return null;
}
