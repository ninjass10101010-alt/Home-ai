import { WebSocket } from 'ws';
import crypto from 'crypto';

const GATEWAY_URL = 'ws://192.168.0.27:18789';
const TOKEN = 'openclaw-key-998877';
const ORIGIN = 'http://192.168.0.27:3000';

// Test each valid client.id to see which ones work
const CLIENT_IDS = ['cli', 'webchat', 'gateway-client', 'node-host', 'test'];

function testClientId(clientId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(GATEWAY_URL, { headers: { Origin: ORIGIN } });
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); resolve({ clientId, result: 'TIMEOUT' }); }
    }, 10000);

    const sendAuth = () => {
      ws.send(JSON.stringify({
        type: 'req', id: 'auth', method: 'connect',
        params: {
          minProtocol: 4, maxProtocol: 4,
          client: { id: clientId, version: '1.0.0', platform: 'linux', mode: 'backend' },
          auth: { token: TOKEN },
          scopes: ['operator.admin', 'operator.write', 'operator.agent']
        }
      }));
    };

    ws.on('open', () => sendAuth());

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.event === 'connect.challenge') { sendAuth(); return; }
      if (msg.id === 'auth') {
        settled = true; clearTimeout(timer); ws.close();
        resolve({ clientId, result: msg.ok ? 'AUTH_OK' : 'AUTH_FAIL', error: msg.error });
      }
    });

    ws.on('error', (e) => { if(!settled){settled=true;clearTimeout(timer);ws.close();resolve({clientId,result:'WS_ERROR',error:e.message});} });
    ws.on('close', () => { if(!settled){settled=true;clearTimeout(timer);resolve({clientId,result:'CLOSED'});} });
  });
}

console.log('Testing valid client.id values...\n');
for (const id of CLIENT_IDS) {
  const r = await testClientId(id);
  console.log(`  client.id="${r.clientId}": ${r.result}${r.error ? ' → ' + r.error.message : ''}`);
}
