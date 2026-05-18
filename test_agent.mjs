import { WebSocket } from 'ws';
import crypto from 'crypto';

const GATEWAY_URL = 'ws://192.168.0.27:18789';
const TOKEN = 'openclaw-key-998877';
const ORIGIN = 'http://192.168.0.27:3000';

function testFinal() {
  return new Promise((resolve) => {
    const ws = new WebSocket(GATEWAY_URL, { headers: { Origin: ORIGIN } });
    let settled = false;
    let authSent = false;
    let events = [];

    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); resolve({ result: 'TIMEOUT', events }); }
    }, 30000);

    const sendAuth = () => {
      if (authSent) return;
      authSent = true;
      console.log('→ Sending auth...');
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
      console.log('✓ Connected');
      setTimeout(() => sendAuth(), 1000); // fallback if no challenge
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.event === 'connect.challenge') {
        console.log('← Challenge received, sending auth...');
        sendAuth();
        return;
      }

      if (msg.id === 'auth') {
        if (msg.ok) {
          console.log('✓ Auth OK! Running consuela agent...');
          ws.send(JSON.stringify({
            type: 'req', id: 'run', method: 'agent',
            params: {
              agentId: 'consuela',
              message: 'Please say hello',
              sessionId: `bridge-${Date.now()}`,
              idempotencyKey: crypto.randomUUID()
            }
          }));
        } else {
          console.log('✗ Auth FAILED:', msg.error.message);
          settled = true; clearTimeout(timer); ws.close();
          resolve({ result: 'AUTH_FAIL', error: msg.error });
        }
        return;
      }

      if (msg.id === 'run') {
        if (msg.ok) {
          console.log('✓ Agent run accepted, waiting for reply...');
        } else {
          console.log('✗ Run FAILED:', msg.error.message);
          settled = true; clearTimeout(timer); ws.close();
          resolve({ result: 'RUN_FAIL', error: msg.error });
        }
        return;
      }

      if (msg.type === 'event') {
        const summary = JSON.stringify(msg.payload || {}).substring(0, 200);
        console.log(`← event: ${msg.event} ${summary}`);
        events.push({ event: msg.event, payload: msg.payload });

        if (msg.event === 'agent' && msg.payload?.data?.delta) {
          process.stdout.write(msg.payload.data.delta);
        }

        if (msg.event === 'chat' && msg.payload?.state === 'turn:complete') {
          console.log('\n✅ SUCCESS — agent replied');
          settled = true; clearTimeout(timer); ws.close();
          resolve({ result: 'SUCCESS', events });
        }

        if (msg.event === 'chat' && msg.payload?.state === 'turn:error') {
          console.log('\n✗ TURN_ERROR');
          settled = true; clearTimeout(timer); ws.close();
          resolve({ result: 'TURN_ERROR', payload: msg.payload, events });
        }
      }

      if (msg.error && !settled) {
        console.log('✗ Error msg:', msg.error.message);
        settled = true; clearTimeout(timer); ws.close();
        resolve({ result: 'MSG_ERROR', error: msg.error, events });
      }
    });

    ws.on('error', (e) => { console.error('WS error:', e.message); if(!settled){settled=true;clearTimeout(timer);resolve({result:'WS_ERROR',error:e.message});} });
    ws.on('close', (code) => { if(!settled){settled=true;clearTimeout(timer);resolve({result:'CLOSED',code,events});} });
  });
}

console.log('=== Full end-to-end Consuela agent test ===\n');
const result = await testFinal();
console.log('\n=== FINAL RESULT ===');
console.log('result:', result.result);
if (result.error) console.log('error:', JSON.stringify(result.error));
if (result.result !== 'SUCCESS') {
  console.log('\nEvents logged:');
  (result.events||[]).forEach(e => console.log(` - ${e.event}:`, JSON.stringify(e.payload||{}).substring(0,150)));
}
