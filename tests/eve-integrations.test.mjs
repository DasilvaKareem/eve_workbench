import test from 'node:test';
import assert from 'node:assert/strict';
import { UIKit } from '@iwsdk/core';
import { IntegrationsClient, integrations } from '../src/eve-integrations.ts';
import { mountSpatialIntegrations } from '../src/eve-spatial-integrations.ts';
import { mountSpatialChat } from '../src/eve-spatial-chat.ts';
import { eve, EveClient } from '../src/eve-client.ts';
import { WorkspaceWindows } from '../src/eve-windows.ts';
import { handleIntegrations, integrationCatalog, integrationStatuses } from '../eve-backend/agent/lib/integrations.ts';
import { resolveIntegrationConnections } from '../eve-backend/agent/connections/apps.ts';

const secret = 'test-integrations-service-key-at-least-32-characters';
const previous = process.env.EVE_API_KEY;
process.env.EVE_API_KEY = secret;
test.after(() => { if (previous === undefined) delete process.env.EVE_API_KEY; else process.env.EVE_API_KEY = previous; });
const request = (method = 'GET') => new Request('https://agent.example/workbench/integrations', { method, headers: { authorization: `Bearer ${secret}` } });
const apps = status => integrationCatalog.map(app => ({ id: app.id, name: app.name, description: app.description, status }));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('integration status is authoritative and never returns credentials or vendor error payloads', async () => {
  const statuses = await integrationStatuses(async app => {
    if (app.id === 'notion') return { token: 'never-publish-this', expiresAt: 9999999999999 };
    if (app.id === 'linear') throw Object.assign(new Error('sign in'), { name: 'UserAuthorizationRequiredError' });
    if (app.id === 'miro') throw Object.assign(new Error('missing'), { status: 404 });
    throw new Error('secret vendor payload');
  });
  assert.deepEqual(statuses.map(app => app.status), ['connected', 'not_connected', 'not_connected', 'unavailable']);
  assert.doesNotMatch(JSON.stringify(statuses), /never-publish|secret vendor/);
  const response = await handleIntegrations(request(), undefined, undefined, { statuses: async () => statuses });
  assert.equal(response.status, 200); assert.equal((await response.json()).scope, 'workspace');
  let called = false;
  const unauthorized = await handleIntegrations(new Request('https://agent.example/workbench/integrations'), undefined, undefined, { statuses: async () => { called = true; } });
  assert.equal(unauthorized.status, 401); assert.equal(called, false);
});

test('the real Connect adapter provisions only on Connect and returns only a safe consent handoff', async t => {
  const originalOidc = process.env.VERCEL_OIDC_TOKEN;
  process.env.VERCEL_OIDC_TOKEN = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-integrations-oidc`;
  const calls = []; let starts = 0;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input); const body = JSON.parse(options.body); calls.push({ path: url.pathname, body });
    if (url.pathname.includes('/authorize/')) {
      if (++starts === 1) return Response.json({ error: { code: 'not_found', message: 'missing connector' } }, { status: 404 });
      return Response.json({ request: 'request-private', verifier: 'verifier-private', url: 'https://vercel.com/connect/authorize/test', deviceCode: 'ABCD', expiresAt: Date.now() + 600_000 });
    }
    assert.equal(url.pathname, '/v1/connect/connectors/managed/oauth');
    assert.equal(body.serverUrl, 'https://mcp.notion.com/mcp');
    return Response.json({ ok: true });
  });
  try {
    const response = await handleIntegrations(request('POST'), 'notion', 'connect');
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.authorization.appId, 'notion'); assert.equal(body.authorization.userCode, 'ABCD');
    assert.equal(calls.length, 3); assert.equal(calls[0].body.subject.id, 'eve-workbench-owner');
    assert.equal(calls[2].body.returnUrl, 'https://eve-workbench.vercel.app/?integrations=connected');
    assert.doesNotMatch(JSON.stringify(body), /request-private|verifier-private|test-integrations-oidc/);
  } finally { if (originalOidc === undefined) delete process.env.VERCEL_OIDC_TOKEN; else process.env.VERCEL_OIDC_TOKEN = originalOidc; }
});

test('unknown apps, unsafe sign-in links, and failed disconnects are not treated as successful connections', async () => {
  const unknown = await handleIntegrations(request('POST'), 'arbitrary-host', 'connect'); assert.equal(unknown.status, 404);
  const bad = await handleIntegrations(request('POST'), 'notion', 'connect', { start: async () => ({ challenge: { url: 'https://vercel.com.evil.example/steal' } }) });
  assert.equal(bad.status, 502);
  const error = await handleIntegrations(request('POST'), 'notion', 'disconnect', { revoke: async () => { throw new Error('private raw token'); } });
  assert.equal(error.status, 502); assert.doesNotMatch(await error.text(), /private raw token/);
  let revoked = false;
  const done = await handleIntegrations(request('POST'), 'notion', 'disconnect', { revoke: async app => { revoked = app.id === 'notion'; } });
  assert.equal(done.status, 200); assert.equal(revoked, true);
});

test('only connected apps reach Eve and read/write approval policy accompanies the actual connection', async () => {
  const dependencies = { statuses: async () => apps('not_connected'), token: async () => ({ token: 'private', expiresAt: 42 }) };
  assert.equal(await resolveIntegrationConnections(dependencies), null);
  dependencies.statuses = async () => apps('not_connected').map(app => ({ ...app, status: app.id === 'notion' ? 'connected' : 'not_connected' }));
  const connections = await resolveIntegrationConnections(dependencies);
  assert.deepEqual(Object.keys(connections), ['notion']);
  assert.equal(connections.notion.url, 'https://mcp.notion.com/mcp');
  assert.deepEqual(await connections.notion.auth.getToken(), { token: 'private', expiresAt: 42 });
  assert.equal(connections.notion.approval({ toolAnnotations: { readOnlyHint: true } }), 'not-applicable');
  assert.equal(connections.notion.approval({ toolAnnotations: { destructiveHint: true } }), 'user-approval');
  assert.equal(connections.notion.approval({}), 'user-approval');
});

test('the integrations client waits for server status before showing Connected and refreshes after disconnect', async () => {
  let connected = false; const paths = [];
  const client = new IntegrationsClient(async (path, options) => {
    paths.push(path); assert.equal(options.credentials, 'same-origin');
    if (path.endsWith('/connect')) return Response.json({ authorization: { appId: 'notion', name: 'Notion', url: 'https://vercel.com/connect/authorize/test' } });
    if (path.endsWith('/disconnect')) { connected = false; return Response.json({ ok: true }); }
    return Response.json({ apps: apps('not_connected').map(app => ({ ...app, status: app.id === 'notion' && connected ? 'connected' : 'not_connected' })) });
  });
  try {
    await client.refresh(); await client.connect('notion');
    assert.equal(client.state.apps[0].status, 'not_connected', 'getting a sign-in URL is not successful consent');
    assert.ok(client.state.authorization); connected = true; await client.refresh();
    assert.equal(client.state.apps[0].status, 'connected'); assert.equal(client.state.authorization, null);
    await client.disconnect('notion'); assert.equal(client.state.apps[0].status, 'not_connected');
    assert.ok(paths.includes('/api/eve/integrations/notion/disconnect'));
  } finally { client.dispose(); }
});

test('native integrations controls show the catalog and the real consent link without custom keyboard input', async () => {
  const original = { ...integrations.state }, fetcher = integrations.fetcher;
  integrations.fetcher = async path => path.endsWith('/connect')
    ? Response.json({ authorization: { appId: 'notion', name: 'Notion', url: 'https://vercel.com/connect/authorize/test' } })
    : Response.json({ apps: apps('not_connected') });
  Object.assign(integrations.state, { apps: [], mode: 'connections', loading: false, busy: null, error: null, authorization: null });
  const viewport = new UIKit.Container({ width: 336, height: 270, overflow: 'scroll' });
  const handoffs = []; const view = mountSpatialIntegrations(viewport, url => handoffs.push(url));
  const find = value => { let found; viewport.traverse(node => { if (node.properties?.peek().text === value) found = node; }); return found; };
  try {
    await tick(); find('+ Add integration').dispatchEvent({ type: 'click' });
    for (const app of integrationCatalog) assert.ok(find(app.name));
    // Invoke the first Connect (Notion), rather than relying on the order of a text search.
    let first; viewport.traverse(node => { if (!first && node.properties?.peek().text === 'Connect') first = node; });
    first.dispatchEvent({ type: 'click' }); await tick();
    assert.ok(find('Continue sign-in to Notion')); assert.equal(integrations.state.apps[0].status, 'not_connected');
    find('Continue sign-in to Notion').dispatchEvent({ type: 'click' });
    assert.deepEqual(handoffs, ['https://vercel.com/connect/authorize/test']);
    view.dispose(); assert.equal(viewport.children.length, 0);
  } finally { viewport.dispose(); integrations.fetcher = fetcher; Object.assign(integrations.state, original); }
});

test('integrations remain accessible at the content-window limit and are never filled by generated charts', () => {
  const client = new EveClient(), windows = new WorkspaceWindows(client);
  try {
    for (let i = 0; i < 6; i++) windows.create();
    windows.openIntegrations(); windows.openIntegrations(); assert.equal(windows.entries.length, 7);
    assert.equal(windows.contentCount, 6); assert.equal(windows.create(), undefined);
    const panel = { id: 'chart', title: 'Chart', blocks: [{ type: 'text', text: 'Result' }], actions: [] };
    client.applyEvent({ type: 'action.result', data: { status: 'completed', result: { toolName: 'workbench_panel', output: { panels: [panel], updatedPanelId: 'chart' } } } });
    assert.equal(windows.entries.find(entry => entry.kind === 'integrations').panel, undefined);
  } finally { windows.dispose(); client.dispose(); }
});

test('the headset displays real integration write approvals and sends the selected response', async () => {
  const original = { ...eve.state }, answer = eve.answer, answers = [];
  eve.state.messages = []; eve.state.inputs = []; eve.answer = async (...args) => { answers.push(args); };
  const viewport = new UIKit.Container({ width: 336, height: 230, overflow: 'scroll' }); const chat = mountSpatialChat(viewport);
  try {
    eve.applyEvent({ type: 'input.requested', data: { requests: [{ requestId: 'approve-write', prompt: 'Allow Notion to update this page?', options: [{ id: 'approve', label: 'Allow update' }, { id: 'deny', label: 'Deny' }] }] } });
    let button; viewport.traverse(node => { if (node.properties?.peek().text === 'Allow update') button = node; });
    assert.ok(button); button.dispatchEvent({ type: 'click' }); assert.deepEqual(answers, [['approve-write', 'approve']]);
    eve.applyEvent({ type: 'input.resolved', data: { resolutions: [{ requestId: 'approve-write' }] } });
    assert.equal(viewport.children.length, 0);
  } finally { chat.dispose(); viewport.dispose(); eve.answer = answer; Object.assign(eve.state, original); }
});
