import { WebSocket } from 'ws';
import crypto from 'crypto';

const GATEWAY_URL = 'ws://192.168.0.27:18789';
const TOKEN = 'openclaw-key-998877';
const ORIGIN = 'http://192.168.0.27:3000';

function testRun(mode) {
  return new Promise((resolve) => {
    const ws = new WebSocket(GATEWAY_URL, { headers: { Origin: ORIGIN } });
    let settled = false;
    let authSent = false;

    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); resolve({ mode, result: 'TIMEOUT' }); }
    }, 15000);

    const sendAuth = () => {
      if (authSent) return;
      authSent = true;
      ws.send(JSON.stringify({
        type: 'req', id: 'auth', method: 'connect',
        params: {
          minProtocol: 4, maxProtocol: 4,
          client: { id: 'node-host', version: '1.0.0', platform: 'linux', mode },
          auth: { token: TOKEN },
          scopes: ['operator.read', 'operator.write', 'operator.admin', 'operator.agent']
        }
      }));
    };

    ws.on('open', () => setTimeout(() => { if (!authSent) sendAuth(); }, 300));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.event === 'connect.challenge') { sendAuth(); return; }

      if (msg.id === 'auth') {
        if (msg.ok) {
          ws.send(JSON.stringify({
            type: 'req', id: 'run', method: 'agent',
            params: { agentId: 'consuela', message: 'hello', sessionId: `t-${Date.now()}`, idempotencyKey: crypto.randomUUID() }
          }));
        } else {
          settled = true; clearTimeout(timer); ws.close(); resolve({ mode, result: 'AUTH_FAIL', error: msg.error.message });
        }
        return;
      }

      if (msg.id === 'run') {
        if (!msg.ok) {
          settled = true; clearTimeout(timer); ws.close(); resolve({ mode, result: 'RUN_FAIL', error: msg.error.message });
        } else {
          settled = true; clearTimeout(timer); ws.close(); resolve({ mode, result: 'RUN_OK' });
        }
      }
    });

    ws.on('error', (e) => { if(!settled){settled=true;clearTimeout(timer);ws.close();resolve({mode,result:'WS_ERROR',error:e.message});} });
    ws.on('close', () => { if(!settled){settled=true;clearTimeout(timer);resolve({mode,result:'CLOSED'});} });
  });
}

for (const mode of ['cli', 'test', 'backend']) {
  const r = await testRun(mode);
  console.log(`Mode "${mode}": ${r.result} ${r.error || ''}`);
}
