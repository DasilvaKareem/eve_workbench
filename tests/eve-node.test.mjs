import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { serveEveRequest } from '../server/eve-node.mjs';

test('Node adapter preserves HTTPS origins and streams an upstream response', async () => {
  const originalFetch = globalThis.fetch;
  const req = new PassThrough();
  req.method = 'POST';
  req.url = '/api/eve/session';
  req.headers = { host: 'workbench.example', origin: 'https://workbench.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json' };
  const chunks = [];
  const res = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
  let status;
  res.writeHead = (value) => { status = value; res.headersSent = true; };
  globalThis.fetch = async (target, options) => {
    assert.equal(target.href, 'https://agent.example/eve/v1/session');
    assert.equal(options.body, '{"message":"hello"}');
    return Response.json({ sessionId: 'wrun_adapter' }, { status: 202 });
  };
  try {
    req.end('{"message":"hello"}');
    await serveEveRequest(req, res, { EVE_AGENT_URL: 'https://agent.example' });
    await finished(res);
    assert.equal(status, 202);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { sessionId: 'wrun_adapter' });
  } finally { globalThis.fetch = originalFetch; }
});
