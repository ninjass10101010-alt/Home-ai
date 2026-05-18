import { WebSocket } from 'ws';

const GATEWAY_URL = 'ws://192.168.0.27:18789';
const TOKEN = 'openclaw-key-998877';
const ORIGIN = 'http://192.168.0.27:3000';

const MODES = ['backend', 'frontend', 'cli', 'test', 'local', 'script', 'system'];

function testMode(mode) {
  return new Promise((resolve) => {
    const ws = new WebSocket(GATEWAY_URL, { headers: { Origin: ORIGIN } });
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); resolve({ mode, result: 'TIMEOUT' }); }
    }, 5000);

    const sendAuth = () => {
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

    ws.on('open', () => sendAuth());

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.event === 'connect.challenge') { sendAuth(); return; }
      if (msg.id === 'auth') {
        settled = true; clearTimeout(timer); ws.close();
        resolve({ mode, result: msg.ok ? 'AUTH_OK' : 'AUTH_FAIL', error: msg.error });
      }
    });

    ws.on('error', (e) => { if(!settled){settled=true;clearTimeout(timer);ws.close();resolve({mode,result:'WS_ERROR',error:e.message});} });
    ws.on('close', () => { if(!settled){settled=true;clearTimeout(timer);resolve({mode,result:'CLOSED'});} });
  });
}

console.log('Testing valid client.mode values...\n');
for (const mode of MODES) {
  const r = await testMode(mode);
  console.log(`  client.mode="${r.mode}": ${r.result}${r.error ? ' → ' + r.error.message : ''}`);
}
