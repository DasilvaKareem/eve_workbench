import { Sandbox } from '@vercel/sandbox';
import { browserAvailable, browserViewerToken, workbenchService } from './workbench-auth.ts';

const locations = new Map<string, { name: string; expires: number }>();
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

/** Service-authenticated access to the exact VM Eve tagged for this session. */
export async function browserFrame(request: Request, sessionId: string, sdk = Sandbox, fetcher = fetch): Promise<Response> {
  if (!await workbenchService(request)) return reply({ error: 'Unauthorized.' }, 401);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) return reply({ error: 'Invalid session.' }, 400);
  if (!browserAvailable()) return reply({ code: 'browser_unavailable', error: 'Browser viewing needs a real Vercel Sandbox. The local just-bash sandbox cannot run Chromium.' }, 503);
  try {
    let location = locations.get(sessionId);
    if (!location || location.expires <= Date.now()) {
      // Eve 0.79 tags each actual session sandbox with sessionId. Do not select
      // a template or a sandbox from another conversation/project.
      const page = await sdk.list({ tags: { sessionId }, limit: 20 });
      const live = page.sandboxes.find(item => item.status === 'running' && item.tags?.workbench === 'browser-v1' && item.tags?.sessionId === sessionId);
      if (!live) return reply({ connected: false, frame: null, url: '', message: 'Waiting for Eve to open its browser.' });
      location = { name: live.name, expires: Date.now() + 15_000 };
      if (locations.size >= 100) locations.clear();
      locations.set(sessionId, location);
    }
    const sandbox = await sdk.get({ name: location.name });
    if (sandbox.tags?.sessionId !== sessionId || sandbox.tags?.workbench !== 'browser-v1') {
      locations.delete(sessionId); return reply({ error: 'Sandbox identity did not match.' }, 403);
    }
    const target = new URL('/frame', sandbox.domain(3001));
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.vercel.run')) throw new Error('Unexpected sandbox domain.');
    let upstream: Response;
    try {
      upstream = await fetcher(target, { headers: { authorization: `Bearer ${browserViewerToken(sessionId)}` }, redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]) });
    } catch {
      // A VM resume restores disk, not background processes. Restart just the
      // read-only relay; a duplicate exits on EADDRINUSE without replacing it.
      await sandbox.runCommand({ cmd: 'node', args: ['/workspace/.eve/browser-relay.mjs'], detached: true });
      return reply({ connected: false, frame: null, url: '', message: 'Reconnecting to the sandbox browser.' });
    }
    if (!upstream.ok) return reply({ error: 'The sandbox viewer is unavailable.' }, 502);
    if (Number(upstream.headers.get('content-length')) > 1_500_000) throw new Error('Frame too large.');
    const raw = await upstream.text();
    if (raw.length > 1_500_000) throw new Error('Frame too large.');
    // Return only the bounded viewer protocol; never relay upstream headers.
    const value = JSON.parse(raw);
    return reply({ connected: value.connected === true, url: typeof value.url === 'string' ? value.url.slice(0, 2048) : '', frame: value.frame ?? null });
  } catch {
    locations.delete(sessionId);
    return reply({ error: 'Cannot reach the sandbox browser. Retry when Eve is using its browser.', code: 'browser_unavailable' }, 502);
  }
}
