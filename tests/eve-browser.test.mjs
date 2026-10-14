import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { BrowserWatch } from '../src/eve-browser-client.ts';
import { browserFrame } from '../eve-backend/agent/lib/browser-viewer.ts';
import { browserViewerToken } from '../eve-backend/agent/lib/workbench-auth.ts';
import { browserRelaySource } from '../eve-backend/agent/lib/browser-relay-source.ts';
import browserTool from '../eve-backend/agent/tools/browser.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const frame = { data: '/9j/2Q==', seq: 1, capturedAt: 123, receivedAt: 124 };

test('browser tool validates navigation and only reports actual command results', async () => {
  process.env.EVE_BROWSER_SANDBOX = 'vercel';
  let command;
  const context = { getSandbox: async () => ({ run: async options => { command = options.command; return { exitCode: 0, stdout: JSON.stringify({ success: true, data: { snapshot: 'A real page snapshot' } }) }; } }) };
  const output = await browserTool.execute({ operation: 'snapshot' }, context);
  assert.equal(output.data.snapshot, 'A real page snapshot');
  assert.match(command, /--session workbench snapshot -i/);
  await assert.rejects(browserTool.execute({ operation: 'open', url: 'file:///etc/passwd' }, context), /HTTP/);
  await assert.rejects(browserTool.execute({ operation: 'open', url: 'https://user:secret@example.com' }, context), /credentials/);
  await assert.rejects(browserTool.execute({ operation: 'click' }, context), /selector/);
  await assert.rejects(browserTool.execute({ operation: 'snapshot' }, { getSandbox: async () => ({ run: async () => ({ exitCode: 1 }) }) }), /failed/);
  delete process.env.EVE_BROWSER_SANDBOX;
});
function client() {
  const listeners = new Set();
  return { state: { sessionId: 'session_one', phase: 'ready' },
    subscribe(fn) { listeners.add(fn); fn(this.state); return () => listeners.delete(fn); },
    patch(value) { Object.assign(this.state, value); for (const fn of listeners) fn(this.state); } };
}

test('default browser viewer transport preserves the browser fetch receiver', async t => {
  t.mock.method(globalThis, 'fetch', async function (path) {
    assert.equal(this, globalThis, 'native fetch must receive the browser global');
    assert.equal(path, '/api/eve/session/session_one/browser/frame');
    return Response.json({ connected: true, frame, url: 'https://example.com' });
  });
  const watch = new BrowserWatch(client());
  try {
    watch.setActive('desktop', true);
    await tick();
    assert.equal(watch.state.connected, true);
    assert.deepEqual(watch.state.frame, frame);
  } finally { watch.dispose(); }
});

test('desktop and XR share one frame request; hiding both aborts it', async () => {
  const source = client(); let calls = 0, signal;
  const watch = new BrowserWatch(source, async (_, options) => {
    calls++; signal = options.signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  });
  watch.setActive('desktop', true); watch.setActive('xr', true);
  assert.equal(calls, 1);
  watch.setActive('desktop', false); assert.equal(signal.aborted, false);
  watch.setActive('xr', false); assert.equal(signal.aborted, true);
  await tick(); watch.dispose();
});

test('a late frame from an old conversation cannot appear in the new conversation', async () => {
  const source = client(); const requests = [];
  const watch = new BrowserWatch(source, () => new Promise(resolve => requests.push(resolve)));
  watch.setActive('xr', true);
  source.patch({ sessionId: 'session_two' });
  requests[0](Response.json({ connected: true, frame, url: 'https://old.example' }));
  requests[1](Response.json({ connected: true, frame: { ...frame, seq: 2 }, url: 'https://new.example' }));
  await tick();
  assert.equal(watch.state.url, 'https://new.example'); assert.equal(watch.state.frame.seq, 2);
  source.patch({ phase: 'locked' });
  assert.equal(watch.state.frame, null); assert.equal(watch.state.url, '');
  watch.dispose();
});

test('malformed frames are rejected instead of becoming renderable URLs', async () => {
  const source = client();
  const watch = new BrowserWatch(source, async () => Response.json({ connected: true, frame: { ...frame, data: '<script>' } }));
  watch.setActive('xr', true); await tick();
  assert.equal(watch.state.frame, null); assert.match(watch.state.message, /invalid frame/);
  watch.dispose();
});

test('frame endpoint checks service auth before any sandbox lookup', async () => {
  process.env.EVE_API_KEY = 'test-service-secret-at-least-32-characters';
  const response = await browserFrame(new Request('https://agent.example/workbench/browser/test/frame'), 'test', {
    list() { throw new Error('must not be called'); },
  });
  assert.equal(response.status, 401);
});

test('frame endpoint selects the exact session VM and keeps its token server side', async () => {
  process.env.EVE_BROWSER_SANDBOX = 'vercel';
  process.env.EVE_API_KEY = 'test-service-secret-at-least-32-characters';
  const sessionId = 'session_isolated';
  const request = new Request('https://agent.example/workbench/browser/test/frame', { headers: { authorization: `Bearer ${process.env.EVE_API_KEY}` } });
  const sdk = {
    async list(options) {
      assert.deepEqual(options.tags, { sessionId });
      return { sandboxes: [
        { name: 'wrong', status: 'running', tags: { sessionId: 'other', workbench: 'browser-v1' } },
        { name: 'correct', status: 'running', tags: { sessionId, workbench: 'browser-v1' } },
      ] };
    },
    async get(options) {
      assert.equal(options.name, 'correct');
      return { tags: { sessionId, workbench: 'browser-v1' }, domain(port) { assert.equal(port, 3001); return 'https://sandbox-3001.vercel.run'; } };
    },
  };
  const response = await browserFrame(request, sessionId, sdk, async (url, options) => {
    assert.equal(url.href, 'https://sandbox-3001.vercel.run/frame');
    assert.equal(options.headers.authorization, `Bearer ${browserViewerToken(sessionId)}`);
    assert.equal(options.redirect, 'error');
    return Response.json({ connected: true, frame, url: 'https://example.com' }, { headers: { 'set-cookie': 'must-not-leak' } });
  });
  assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual((await response.json()).frame, frame);
  delete process.env.EVE_BROWSER_SANDBOX;
});

test('the actual relay accepts only authenticated frame reads and never forwards input', () => {
  let handler, socket;
  const timers = new Set();
  class FakeSocket {
    listeners = {};
    constructor(url) { assert.match(url, /127.0.0.1:9223/); socket = this; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    close() {}
    send() { assert.fail('watch-only relay must never send browser input'); }
  }
  const executable = browserRelaySource.replace(/^import .*;\n/gm, '');
  vm.runInNewContext(executable, {
    Buffer, WebSocket: FakeSocket, URL, Date, JSON,
    readFileSync: () => 'private-viewer-token',
    timingSafeEqual: (a, b) => a.equals(b),
    createServer(fn) { handler = fn; return { listen(port, host) { assert.equal(port, 3001); assert.equal(host, '0.0.0.0'); } }; },
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
    setInterval() { return { unref() {} }; },
  });
  const read = (method = 'GET', token = 'private-viewer-token', url = '/frame') => {
    const response = { status: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(code) { this.status = code; }, end(value) { this.body = JSON.parse(value); } };
    handler({ method, url, headers: { authorization: `Bearer ${token}` } }, response); return response;
  };
  assert.equal(read('GET', 'wrong').status, 401); assert.equal(socket, undefined);
  assert.equal(read('POST').status, 404); assert.equal(socket, undefined);
  assert.equal(read('GET', 'private-viewer-token', '/input').status, 404);
  assert.equal(read().body.frame, null);
  socket.listeners.message({ data: JSON.stringify({ type: 'frame', data: frame.data, seq: 4, metadata: { timestamp: 123 } }) });
  const response = read(); assert.equal(response.body.frame.seq, 4); assert.equal(response.headers['cache-control'], 'no-store');
  socket.listeners.message({ data: JSON.stringify({ type: 'input_mouse', x: 20, y: 30 }) });
  assert.equal(read().body.frame.seq, 4);
});
