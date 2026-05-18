import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import crypto from 'crypto';

const GATEWAY_URL = process.env.OPENCLAW_WS_URL || 'ws://openclaw:18789';
const TOKEN = process.env.OPENCLAW_TOKEN || 'openclaw-key-998877-aBcDeFgHiJkLmNoPqRsTuVwXyZ';
const PORT = process.env.PORT || 3005;

// HTTP Server for Dashboard Chat (HTTP POST)
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message } = JSON.parse(body);
        const reply = await talkToConsuela(message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

// WebSocket Server for Dashboard (to receive "driving" commands from AI)
const wss = new WebSocketServer({ server });
let dashboardSocket = null;

wss.on('connection', (ws) => {
  console.log('Dashboard connected to bridge WS');
  dashboardSocket = ws;
  ws.on('close', () => { dashboardSocket = null; });
});

// Helper to talk to OpenClaw
function talkToConsuela(message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL, { headers: { Origin: 'http://192.168.0.27:3000' } });
    let fullReply = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error('Gateway timeout'));
      }
    }, 60000);

    let authSent = false;
    const sendAuth = () => {
      if (authSent) return;
      authSent = true;
      ws.send(JSON.stringify({
        type: 'req', id: 'auth', method: 'connect',
        params: {
          minProtocol: 4, maxProtocol: 4,
          client: { id: 'node-host', version: '2.0.0', platform: 'linux', mode: 'backend' },
          auth: { token: TOKEN },
          scopes: ['operator.read', 'operator.write', 'operator.admin', 'operator.agent']
        }
      }));
    };

    ws.on('open', () => {
      // Wait briefly — gateway sends a challenge first in protocol 4
      // Fall back to sending auth if no challenge arrives within 1s
      setTimeout(() => sendAuth(), 1000);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.event === 'connect.challenge') {
          sendAuth();
        }

        // Auth success -> Run Agent
        if (msg.id === 'auth' && msg.ok) {
          ws.send(JSON.stringify({
            type: 'req', id: 'run', method: 'agent',
            params: { 
              agentId: 'consuela', 
              message, 
              sessionId: 'bridge-' + Date.now(), 
              idempotencyKey: crypto.randomUUID() 
            }
          }));
        }

        // Handle streaming text
        if (msg.type === 'event' && msg.event === 'agent' && msg.payload?.stream === 'assistant') {
          if (msg.payload.data?.delta) fullReply += msg.payload.data.delta;
        }

        // Handle CONTROL/DRIVE events from agent
        // If the agent sends a 'control' event, forward it to the dashboard
        if (msg.type === 'event' && msg.event === 'control' && dashboardSocket) {
          console.log('Forwarding control event to dashboard:', msg.payload);
          dashboardSocket.send(JSON.stringify(msg.payload));
        }

        // Completion
        if (msg.type === 'event' && msg.event === 'chat' && msg.payload?.state === 'turn:complete') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            ws.close();
            resolve(fullReply || 'Done');
          }
        }

        if (msg.error && !settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          reject(new Error(msg.error.message));
        }
      } catch (e) { console.error('Bridge error:', e); }
    });

    ws.on('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    });
  });
}

server.listen(PORT, '0.0.0.0', () => console.log('Fixed Bridge listening on port ' + PORT));
