import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEveRequest } from '../server/eve-proxy.mjs';

const env = { NODE_ENV: 'production', WORKBENCH_ACCESS_KEY: 'a-personal-workspace-access-code', EVE_AGENT_URL: 'https://agent.example', EVE_API_KEY: 'backend-service-secret-never-in-the-browser' };
const request = (path, options = {}) => new Request(`https://workbench.example/api/eve${path}`, options);
async function cookie() {
  const response = await handleEveRequest(request('/access', { method: 'POST', body: JSON.stringify({ accessCode: env.WORKBENCH_ACCESS_KEY }) }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  return response.headers.get('set-cookie').split(';')[0];
}

test('integration management uses the private access gate, fixed app routes, and same-origin writes', async () => {
  const locked = await handleEveRequest(request('/integrations'), env, () => assert.fail('must authenticate first'));
  assert.equal(locked.status, 401);
  const access = await cookie();
  for (const path of ['/integrations', '/integrations/notion/connect', '/integrations/notion/disconnect']) {
    const response = await handleEveRequest(request(path, { method: path === '/integrations' ? 'GET' : 'POST', headers: { cookie: access, origin: 'https://workbench.example' }, ...(path === '/integrations' ? {} : { body: '{}' }) }), env,
      async (url, options) => { assert.equal(url.href, `https://agent.example/workbench${path}`); assert.equal(options.headers.authorization, `Bearer ${env.EVE_API_KEY}`); return Response.json({ ok: true }); });
    assert.equal(response.status, 200);
  }
  const foreign = await handleEveRequest(request('/integrations/notion/connect', { method: 'POST', body: '{}', headers: { cookie: access, origin: 'https://other.example' } }), env);
  assert.equal(foreign.status, 403);
  const unknown = await handleEveRequest(request('/integrations/arbitrary/connect', { method: 'POST', body: '{}', headers: { cookie: access } }), env);
  assert.equal(unknown.status, 404);
});

test('browser frames use the same private access gate and a fixed backend route', async () => {
  const locked = await handleEveRequest(request('/session/wrun_test/browser/frame'), env, () => assert.fail('must authenticate first'));
  assert.equal(locked.status, 401);
  const response = await handleEveRequest(request('/session/wrun_test/browser/frame?url=https://untrusted.example', { headers: { cookie: await cookie() } }), env, async (url, options) => {
    assert.equal(url.href, 'https://agent.example/workbench/browser/wrun_test/frame');
    assert.equal(options.headers.authorization, `Bearer ${env.EVE_API_KEY}`);
    return Response.json({ connected: true, frame: null });
  });
  assert.equal(response.status, 200);
  const input = await handleEveRequest(request('/session/wrun_test/browser/frame', { method: 'POST', body: '{}', headers: { cookie: await cookie() } }), env);
  assert.equal(input.status, 404);
});

test('production fails closed and status never discloses secrets', async () => {
  const status = await handleEveRequest(request('/status'), env);
  assert.deepEqual(await status.json(), { configured: true, authenticated: false, authRequired: true });
  const response = await handleEveRequest(request('/session', { method: 'POST', body: '{}' }), env, () => { throw new Error('must not call backend'); });
  assert.equal(response.status, 401);
  const missing = await handleEveRequest(request('/access', { method: 'POST', body: '{}' }), { NODE_ENV: 'production' });
  assert.equal(missing.status, 503);
});

test('access code, malformed JSON, and forged cookies are rejected', async () => {
  for (const body of ['null', '{}', '{', JSON.stringify({ accessCode: 'incorrect' })]) {
    const response = await handleEveRequest(request('/access', { method: 'POST', body }), env);
    assert.ok(response.status >= 400);
  }
  const response = await handleEveRequest(request('/health', { headers: { cookie: 'eve-workbench=9999999999999.forged' } }), env);
  assert.equal(response.status, 401);
});

test('a short workspace code unlocks production and rotating it invalidates old cookies', async () => {
  const settings = { ...env, WORKBENCH_ACCESS_KEY: 'test-code' };
  const access = await handleEveRequest(request('/access', {
    method: 'POST', body: JSON.stringify({ accessCode: settings.WORKBENCH_ACCESS_KEY }),
  }), settings);
  assert.equal(access.status, 200);
  const headers = { cookie: access.headers.get('set-cookie').split(';')[0] };
  const health = await handleEveRequest(request('/health', { headers }), settings,
    async () => Response.json({ ok: true }));
  assert.equal(health.status, 200);
  const status = await handleEveRequest(request('/status'), settings);
  assert.equal((await status.json()).configured, true);
  const previous = await handleEveRequest(request('/health', { headers: { cookie: await cookie() } }), settings,
    () => assert.fail('old cookies must not reach the backend'));
  assert.equal(previous.status, 401);
});

test('proxy forwards only configured service credentials and supported routes', async () => {
  const access = await cookie();
  const response = await handleEveRequest(request('/session', { method: 'POST', headers: { cookie: access, authorization: 'Bearer browser-value', 'content-type': 'application/json' }, body: '{"message":"hello"}' }), env, async (url, options) => {
    assert.equal(url.href, 'https://agent.example/eve/v1/session');
    assert.equal(options.headers.authorization, `Bearer ${env.EVE_API_KEY}`);
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.body, '{"message":"hello"}');
    return Response.json({ sessionId: 'wrun_test' }, { status: 202 });
  });
  assert.equal(response.status, 202);
  for (const path of ['/private', '/session/test/files', '/session/test%2Fother/stream']) {
    const result = await handleEveRequest(request(path, { headers: { cookie: access } }), env);
    assert.equal(result.status, 404);
  }
});

test('cross-origin writes are rejected even with a valid cookie', async () => {
  const response = await handleEveRequest(request('/session', { method: 'POST', headers: { cookie: await cookie(), origin: 'https://untrusted.example' }, body: '{}' }), env);
  assert.equal(response.status, 403);
});

test('audio transcription uses the same private gate and a bounded JSON upload', async () => {
  const body = JSON.stringify({ audio: 'a'.repeat(100_000), mediaType: 'audio/webm', durationMs: 1000 });
  const locked = await handleEveRequest(request('/transcribe', { method: 'POST', body }), env, () => assert.fail('must unlock first'));
  assert.equal(locked.status, 401);
  const response = await handleEveRequest(request('/transcribe', { method: 'POST', body, headers: { cookie: await cookie() } }), env, async (url, options) => {
    assert.equal(url.href, 'https://agent.example/workbench/transcribe');
    assert.equal(options.headers.authorization, `Bearer ${env.EVE_API_KEY}`);
    assert.equal(options.body, body);
    return Response.json({ text: 'Hello Eve.' });
  });
  assert.equal(response.status, 200);
  const huge = await handleEveRequest(request('/transcribe', { method: 'POST', body: 'x'.repeat(2_100_001), headers: { cookie: await cookie() } }), env, () => assert.fail('must bound upload first'));
  assert.equal(huge.status, 413);
});

test('NDJSON is streamed intact with cursor and version headers', async () => {
  const output = '{"type":"message.appended","data":{"messageDelta":"hello"}}\n';
  const response = await handleEveRequest(request('/session/wrun_test/stream?startIndex=8&unsafe=discard', { headers: { cookie: await cookie() } }), env, async (url) => {
    assert.equal(url.href, 'https://agent.example/eve/v1/session/wrun_test/stream?startIndex=8');
    return new Response(output, { headers: { 'content-type': 'application/x-ndjson', 'x-eve-stream-version': '26', 'set-cookie': 'upstream-secret' } });
  });
  assert.equal(await response.text(), output);
  assert.equal(response.headers.get('x-eve-stream-version'), '26');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.match(response.headers.get('cache-control'), /no-transform/);
});

test('invalid cursors, oversized bodies, and backend redirects fail predictably', async () => {
  const headers = { cookie: await cookie() };
  const cursor = await handleEveRequest(request('/session/wrun_test/stream?startIndex=-1', { headers }), env);
  assert.equal(cursor.status, 400);
  const oversized = await handleEveRequest(request('/session', { method: 'POST', headers, body: 'x'.repeat(66000) }), env);
  assert.equal(oversized.status, 413);
  const redirect = await handleEveRequest(request('/health', { headers }), env, async () => new Response(null, { status: 307, headers: { location: 'https://login.example' } }));
  assert.equal(redirect.status, 502);
  assert.equal((await redirect.json()).code, 'agent_redirect');
});
