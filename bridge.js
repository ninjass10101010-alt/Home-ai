const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

// Target the socat proxy on port 18800 instead of 18789
const GATEWAY_URL = process.env.OPENCLAW_WS_URL || 'ws://openclaw:18800';
const TOKEN = process.env.OPENCLAW_TOKEN || 'openclaw-key-998877';
const PORT = 3005;

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

function talkToConsuela(message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    let fullReply = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error('Gateway timeout'));
      }
    }, 120000); // extended to 2 minutes

    ws.on('open', () => {
      // Send connect request immediately (gateway may still issue a challenge which we handle below)
      ws.send(JSON.stringify({
        type: 'req', id: 'auth', method: 'connect',
        params: {
          minProtocol: 3, maxProtocol: 3,
          client: { id: 'gateway-client', version: '1.0.0', platform: 'linux', mode: 'backend' },
          auth: { token: TOKEN },
          scopes: ['operator.admin', 'operator.write', 'operator.agent']
        }
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle optional challenge (some gateways still emit it)
        if (msg.event === 'connect.challenge') {
          ws.send(JSON.stringify({
            type: 'req', id: 'auth', method: 'connect',
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: { id: 'gateway-client', version: '1.0.0', platform: 'linux', mode: 'backend' },
              auth: { token: TOKEN },
              scopes: ['operator.admin', 'operator.write', 'operator.agent']
            }
          }));
        }

        // Once authorized, trigger the agent run
        if (msg.id === 'auth' && msg.ok) {
          ws.send(JSON.stringify({
            type: 'req', id: 'run', method: 'agent',
            params: { agentId: 'consuela', message, sessionId: 'bridge-' + Date.now(), idempotencyKey: crypto.randomUUID() }
          }));
        }

        // Accumulate streaming text from the agent (OpenClaw uses 'assistant' stream type)
        if (msg.type === 'event' && msg.event === 'agent' && 
            (msg.payload?.stream === 'assistant' || msg.payload?.stream === 'text')) {
          if (msg.payload.data?.delta) fullReply += msg.payload.data.delta;
          else if (msg.payload.data?.text) fullReply = msg.payload.data.text;
        }

        // When the chat turn finishes, resolve with the collected reply
        if (msg.type === 'event' && msg.event === 'chat' && msg.payload?.state === 'turn:complete') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            ws.close();
            resolve(fullReply || 'No response');
          }
        }

        // Propagate any gateway error back to the caller
        if (msg.error && !settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          reject(new Error(msg.error.message));
        }
      } catch (e) {}
    });

    // Fallback: if the socket closes before a turn:complete event, resolve with whatever we have
    ws.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(fullReply || 'No response');
      }
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

server.listen(PORT, '0.0.0.0', () => console.log('Bridge listening on port ' + PORT));
