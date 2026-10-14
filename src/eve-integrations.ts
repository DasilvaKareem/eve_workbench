export interface AppIntegration {
  id: string; name: string; description: string; status: 'connected' | 'not_connected' | 'unavailable';
}
export interface IntegrationAuthorization { appId: string; name: string; url: string; userCode?: string; expiresAt?: string }
export interface IntegrationsState {
  apps: AppIntegration[]; mode: 'connections' | 'catalog'; loading: boolean; busy: string | null;
  error: string | null; authorization: IntegrationAuthorization | null;
}

const validLink = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && (url.hostname === 'vercel.com' || url.hostname.endsWith('.vercel.com')); } catch { return false; }
};

export class IntegrationsClient {
  readonly state: IntegrationsState = { apps: [], mode: 'connections', loading: false, busy: null, error: null, authorization: null };
  private listeners = new Set<(state: IntegrationsState) => void>();
  private fetcher: typeof fetch;
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(fetcher = globalThis.fetch.bind(globalThis)) { this.fetcher = fetcher; }
  subscribe(listener: (state: IntegrationsState) => void) {
    this.listeners.add(listener); listener(this.state);
    if (this.listeners.size === 1) void this.refresh();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) { clearTimeout(this.timer); this.timer = undefined; } };
  }
  private emit() { for (const listener of this.listeners) listener(this.state); }
  showCatalog(show = true) { this.state.mode = show ? 'catalog' : 'connections'; this.emit(); }
  private async request(path: string, method = 'GET') {
    const response = await this.fetcher(`/api/eve/integrations${path}`, { method, credentials: 'same-origin', signal: AbortSignal.timeout(20_000),
      ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not reach Eve integrations.');
    return body;
  }
  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.state.loading = true; this.state.error = null; this.emit();
    this.loading = (async () => {
      try {
        const body = await this.request('');
        if (!Array.isArray(body.apps) || body.apps.length > 100 || !body.apps.every((app: AppIntegration) => app && /^[a-z][a-z0-9_-]{0,63}$/.test(app.id)
          && typeof app.name === 'string' && typeof app.description === 'string' && ['connected', 'not_connected', 'unavailable'].includes(app.status))) throw new Error('Eve returned an invalid app list.');
        this.state.apps = body.apps;
        const auth = this.state.authorization;
        if (auth && body.apps.some((app: AppIntegration) => app.id === auth.appId && app.status === 'connected')) {
          this.state.authorization = null; this.state.mode = 'connections';
        } else if (auth?.expiresAt && Date.parse(auth.expiresAt) <= Date.now()) {
          this.state.authorization = null; this.state.error = 'Sign-in expired. Press Connect to try again.';
        }
      } catch (error) { this.state.error = error instanceof Error ? error.message : 'Could not load integrations.'; }
      finally { this.state.loading = false; this.loading = null; this.emit(); this.poll(); }
    })();
    return this.loading;
  }
  private poll() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.listeners.size && this.state.authorization) this.timer = setTimeout(() => { void this.refresh(); }, 8000);
  }
  async connect(id: string) {
    if (this.state.busy || !this.state.apps.some(app => app.id === id)) return;
    this.state.busy = id; this.state.error = null; this.state.authorization = null; this.emit();
    try {
      const body = await this.request(`/${encodeURIComponent(id)}/connect`, 'POST'), auth = body.authorization;
      if (!auth || auth.appId !== id || typeof auth.name !== 'string' || !validLink(auth.url)) throw new Error('Could not get a valid sign-in link.');
      this.state.authorization = { appId: id, name: auth.name, url: auth.url,
        ...(typeof auth.userCode === 'string' ? { userCode: auth.userCode } : {}),
        expiresAt: typeof auth.expiresAt === 'string' && Number.isFinite(Date.parse(auth.expiresAt)) ? auth.expiresAt : new Date(Date.now() + 10 * 60_000).toISOString() };
    } catch (error) { this.state.error = error instanceof Error ? error.message : 'Could not start sign-in.'; }
    finally { this.state.busy = null; this.emit(); this.poll(); }
  }
  async disconnect(id: string) {
    if (this.state.busy || !this.state.apps.some(app => app.id === id && app.status === 'connected')) return;
    this.state.busy = id; this.state.error = null; this.emit();
    try { await this.request(`/${encodeURIComponent(id)}/disconnect`, 'POST'); await this.refresh(); }
    catch (error) { this.state.error = error instanceof Error ? error.message : 'Could not disconnect this app.'; }
    finally { this.state.busy = null; this.emit(); }
  }
  dispose() { clearTimeout(this.timer); this.listeners.clear(); }
}

export const integrations = new IntegrationsClient();
