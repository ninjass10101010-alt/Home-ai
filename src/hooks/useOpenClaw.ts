import { useState, useEffect, useRef, useCallback } from "react";

interface OpenClawOptions {
  url: string;
  token: string;
  agentId: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  actions?: any[];
}

export function useOpenClaw({ url, token, agentId }: OpenClawOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageBufferRef = useRef<Record<string, string>>({});

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const genId = () => Math.random().toString(36).substring(2, 15);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    // Fallback: if no challenge arrives, try to connect anyway after 1s
    connectTimerRef.current = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN && !isConnected) {
        ws.send(JSON.stringify({
          type: "req",
          id: genId(),
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "webchat-ui", version: "1.0.2", platform: "web", mode: "webchat" },
            auth: { token },
            role: "operator",
            scopes: ["operator.admin"],
            device: { 
              id: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
              publicKey: "YQ",
              signature: "bW9jay1zaWduYXR1cmU",
              signedAt: Date.now()
            }
          }
        }));
      }
    }, 1000);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        // Handle connect challenge
        if (msg.type === "event" && msg.event === "connect.challenge") {
          const nonce = msg.payload?.nonce;
          ws.send(JSON.stringify({
            type: "req",
            id: genId(),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: { 
                id: "webchat-ui", 
                version: "1.0.2", 
                platform: "web", 
                mode: "webchat" 
              },
              auth: { token },
              role: "operator",
              scopes: ["operator.admin"],
              device: {
                id: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
                publicKey: "YQ",
                signature: "bW9jay1zaWduYXR1cmU",
                signedAt: Date.now(),
                nonce
              }
            }
          }));
          return;
        }

        if (msg.type === "res" && msg.ok && msg.payload?.type === "hello-ok") {
          setIsConnected(true);
        }

        if (msg.type === "event" && msg.event === "agent") {
          const reqId = msg.reqId || msg.id; // Support both
          if (msg.payload?.stream === "text") {
            const text = msg.payload.data?.text || "";
            messageBufferRef.current[reqId] = text;
            
            setMessages(prev => {
              const newMsgs = [...prev];
              const idx = newMsgs.findIndex(m => m.id === reqId);
              if (idx !== -1) {
                newMsgs[idx] = { ...newMsgs[idx], content: text };
              }
              return newMsgs;
            });
          }
        }

        if (msg.type === "event" && msg.event === "chat" && msg.payload?.state === "turn:complete") {
          setIsTyping(false);
        }
      } catch (err) {
        console.error("WS Parse error", err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(connect, 5000); // Reconnect
    };
    
    ws.onerror = () => {
      ws.close();
    };
  }, [url, token]);

  useEffect(() => {
    connect();
    return () => {
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const sendMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const genId = () => Math.random().toString(36).substring(2, 15);
    const reqId = genId();
    const userMsg: Message = {
      id: genId(),
      role: "user",
      content: text,
      timestamp: "Just now"
    };

    const asstMsg: Message = {
      id: reqId,
      role: "assistant",
      content: "",
      timestamp: "Just now"
    };

    setMessages(prev => [...prev, userMsg, asstMsg]);
    setIsTyping(true);

    wsRef.current.send(JSON.stringify({
      type: "req",
      id: reqId,
      method: "agent",
      params: {
        agentId,
        message: text,
        sessionId: "family-dashboard"
      }
    }));
  }, [agentId]);

  return { messages, setMessages, isTyping, isConnected, sendMessage };
}
