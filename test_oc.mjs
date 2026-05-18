import { WebSocket } from 'ws';
const ws = new WebSocket('ws://192.168.0.27:18789', { headers: { Origin: 'http://192.168.0.27:3000' } });
ws.on('open', () => {
    console.log('connected');
    ws.send(JSON.stringify({
        type: 'req', id: 'auth', method: 'connect',
        params: {
          minProtocol: 4, maxProtocol: 4,
          client: { id: 'webchat-ui', version: '2.0.0', platform: 'linux', mode: 'backend' },
          auth: { token: 'openclaw-key-998877' },
          scopes: ['operator.admin', 'operator.agent']
        }
    }));
});
ws.on('message', (msg) => {
    console.log('msg:', msg.toString());
    const data = JSON.parse(msg.toString());
    if (data.id === 'auth' && data.ok) {
        ws.send(JSON.stringify({
            type: 'req', id: 'run', method: 'agent',
            params: { 
              agentId: 'consuela', 
              message: 'hello', 
              sessionId: 'bridge-' + Date.now(), 
              idempotencyKey: 'test-123' 
            }
        }));
    }
});
ws.on('error', (err) => console.error('err:', err.message));
ws.on('close', (code, reason) => console.log('close:', code, reason.toString()));
