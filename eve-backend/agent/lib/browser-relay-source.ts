/** Executed inside the VM. No input endpoint and no browser-control messages. */
export const browserRelaySource = String.raw`
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const token = readFileSync('/workspace/.eve/browser-viewer-token', 'utf8').trim();
let socket, retry, lastWatch = 0, frame = null, url = '', connected = false;
const same = value => {
  const a = Buffer.from(value || ''), b = Buffer.from('Bearer ' + token);
  return a.length === b.length && timingSafeEqual(a, b);
};
function connect() {
  if (socket || Date.now() - lastWatch > 12000) return;
  const ws = socket = new WebSocket('ws://127.0.0.1:9223/?maxFps=2');
  const timeout = setTimeout(() => ws.close(), 4000);
  ws.addEventListener('open', () => clearTimeout(timeout));
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string' || event.data.length > 1500000) return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'frame' && typeof message.data === 'string'
          && message.data.length < 1400000 && /^[A-Za-z0-9+/=]+$/.test(message.data)) {
        frame = { data: message.data, capturedAt: Number(message.metadata?.timestamp) || Date.now(), receivedAt: Date.now(), seq: message.seq };
      } else if (message.type === 'url' && typeof message.url === 'string') url = message.url.slice(0, 2048);
      else if (message.type === 'status') connected = message.connected === true;
    } catch {}
  });
  ws.addEventListener('error', () => { ws.close(); });
  ws.addEventListener('close', () => {
    clearTimeout(timeout); if (socket === ws) socket = null;
    connected = false; clearTimeout(retry); retry = setTimeout(connect, 1500);
  });
}
setInterval(() => {
  if (Date.now() - lastWatch > 12000) { socket?.close(); frame = null; }
}, 4000).unref();
createServer((request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json');
  if (!same(request.headers.authorization)) { response.writeHead(401); response.end('{}'); return; }
  if (request.method !== 'GET' || request.url !== '/frame') { response.writeHead(404); response.end('{}'); return; }
  lastWatch = Date.now(); connect();
  response.end(JSON.stringify({ connected, url, frame }));
}).listen(3001, '0.0.0.0');
`;
