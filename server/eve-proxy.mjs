import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'eve-workbench';
const MAX_BODY = 64 * 1024;
const MAX_AUDIO_BODY = 2_100_000;
const SESSION_ROUTE = /^\/session(?:\/[A-Za-z0-9_-]{1,200}(?:\/(?:stream|cancel|reset))?)?$/;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json', 'cache-control': 'no-store', ...headers,
  } });
}

function equal(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function authorized(request, secret, production) {
  if (!secret) return !production;
  const cookie = request.headers.get('cookie')?.split(';').map(x => x.trim())
    .find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!cookie) return false;
  const [expiry, signature] = cookie.split('.');
  return Boolean(expiry && signature && Number(expiry) > Date.now()
    && equal(signature, sign(expiry, secret)));
}

export async function handleEveRequest(request, env = process.env, fetcher = fetch) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/eve/, '') || '/status';
  const production = env.NODE_ENV === 'production' || (env.VERCEL_ENV && env.VERCEL_ENV !== 'development');
  const secret = env.WORKBENCH_ACCESS_KEY || '';
  const authenticated = authorized(request, secret, production);
  const backend = env.EVE_AGENT_URL || (!production ? 'http://127.0.0.1:2000' : '');

  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return json({ error: 'This request must come from the workbench.', code: 'origin_rejected' }, 403);
    }
  }

  if (path === '/access' && request.method === 'POST') {
    if (production && secret.length < 8) {
      return json({ error: 'Set WORKBENCH_ACCESS_KEY to at least 8 characters on the frontend deployment.', code: 'setup_required' }, 503);
    }
    if (Number(request.headers.get('content-length')) > 2048) return json({ error: 'Request too large.' }, 413);
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: 'Request too large.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Expected JSON.' }, 400); }
    if (!body || typeof body !== 'object' || (secret && (typeof body.accessCode !== 'string' || !equal(body.accessCode, secret)))) {
      return json({ error: 'That access code is incorrect.', code: 'invalid_access' }, 401);
    }
    const expiry = String(Date.now() + 8 * 60 * 60 * 1000);
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${expiry}.${sign(expiry, secret)}; HttpOnly; SameSite=Strict; Path=/api/eve; Max-Age=28800${production ? '; Secure' : ''}` });
  }

  if (path === '/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/eve; Max-Age=0${production ? '; Secure' : ''}` });
  }

  if (path === '/status' && request.method === 'GET') {
    return json({ configured: Boolean(backend && (!production || secret.length >= 8)), authenticated,
      authRequired: Boolean(secret) || Boolean(production) });
  }

  if (!authenticated) return json({ error: 'Unlock the workbench first.', code: 'authentication_required' }, 401);
  if (!backend || (production && secret.length < 8)) {
    return json({ error: 'Configure EVE_AGENT_URL and WORKBENCH_ACCESS_KEY on the frontend deployment.', code: 'setup_required' }, 503);
  }

  const isStream = path.endsWith('/stream');
  const isTranscription = path === '/transcribe';
  const isBrowser = /^\/session\/[A-Za-z0-9_-]{1,200}\/browser\/frame$/.test(path);
  const isIntegrations = path === '/integrations' || /^\/integrations\/(?:notion|linear|miro|sentry)\/(?:connect|disconnect)$/.test(path);
  const isSession = SESSION_ROUTE.test(path);
  const allowed = request.method === 'GET' ? (path === '/integrations' || isBrowser || path === '/health' || path === '/info' || (isSession && isStream))
    : request.method === 'POST' && ((isIntegrations && path !== '/integrations') || (isSession && !isStream) || isTranscription);
  if (!allowed) return json({ error: 'Unknown Eve route.' }, 404);

  let target;
  try {
    target = new URL(backend);
    if (target.username || target.password || target.search || target.hash) throw new Error();
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) throw new Error();
    target.pathname = `${target.pathname.replace(/\/$/, '')}${isIntegrations ? `/workbench${path}` : isTranscription ? '/workbench/transcribe' : isBrowser ? `/workbench/browser/${path.split('/')[2]}/frame` : `/eve/v1${path}`}`;
    if (isStream) {
      const startIndex = url.searchParams.get('startIndex');
      if (startIndex !== null) {
        if (!/^\d+$/.test(startIndex) || !Number.isSafeInteger(Number(startIndex))) return json({ error: 'Invalid stream cursor.' }, 400);
        target.searchParams.set('startIndex', startIndex);
      }
    }
  } catch {
    return json({ error: 'EVE_AGENT_URL must be an HTTPS origin (or localhost for development).', code: 'setup_required' }, 503);
  }

  let body;
  if (request.method === 'POST') {
    const limit = isTranscription ? MAX_AUDIO_BODY : MAX_BODY;
    if (Number(request.headers.get('content-length')) > limit) return json({ error: 'Message too large.' }, 413);
    body = await request.text();
    if (Buffer.byteLength(body) > limit) return json({ error: 'Message too large.' }, 413);
    try { JSON.parse(body || '{}'); } catch { return json({ error: 'Expected JSON.' }, 400); }
  }

  const headers = { accept: isStream ? 'application/x-ndjson' : 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (env.EVE_API_KEY) headers.authorization = `Bearer ${env.EVE_API_KEY}`;
  const timeout = AbortSignal.timeout(isStream ? 270_000 : isTranscription ? 60_000 : 20_000);
  try {
    const response = await fetcher(target, { method: request.method, headers, body,
      redirect: 'manual', signal: AbortSignal.any([request.signal, timeout]) });
    if (response.status >= 300 && response.status < 400) {
      return json({ error: 'The agent redirected the request. Use its canonical deployment URL and check deployment protection.', code: 'agent_redirect' }, 502);
    }
    const outgoing = new Headers({ 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' });
    for (const name of ['content-type', 'x-eve-stream-version', 'x-eve-session-id', 'x-eve-stream-tail-index', 'retry-after']) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return json({ error: error.name === 'TimeoutError' ? 'The Eve agent timed out. Try again.' : 'Cannot reach the Eve agent. Start the backend or check EVE_AGENT_URL.', code: 'agent_unavailable' }, 502);
  }
}

export { MAX_BODY, MAX_AUDIO_BODY };
