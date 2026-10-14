import type { EveClient } from './eve-client.js';

export interface BrowserFrame { data: string; capturedAt: number; receivedAt: number; seq: number }
export interface BrowserViewState { frame: BrowserFrame | null; connected: boolean; url: string; message: string; sessionId: string | null }

/** One bounded, nonoverlapping frame request shared by desktop and XR viewers. */
export class BrowserWatch {
  state: BrowserViewState = { frame: null, connected: false, url: '', message: 'Ask Eve to open a website.', sessionId: null };
  private listeners = new Set<(state: BrowserViewState) => void>();
  private viewers = new Set<string>();
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopEve: () => void;
  private blocked = false;
  private disposed = false;
  private fetcher: typeof fetch;

  constructor(client: EveClient, fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
    this.stopEve = client.subscribe(state => {
      const changed = this.state.sessionId !== state.sessionId;
      const blocked = ['locked', 'setup', 'connecting'].includes(state.phase);
      if (changed || blocked !== this.blocked) {
        this.stop(); this.blocked = blocked;
        this.state = { frame: null, connected: false, url: '', sessionId: state.sessionId, message: blocked ? 'Connect and unlock the workspace to watch.' : 'Waiting for Eve to open its browser.' };
        this.emit(); this.start();
      }
    });
  }
  subscribe(listener: (state: BrowserViewState) => void) {
    this.listeners.add(listener); listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  setActive(viewer: string, active: boolean) {
    if (active) this.viewers.add(viewer); else this.viewers.delete(viewer);
    if (this.viewers.size) this.start(); else this.stop();
  }
  private emit() { for (const listener of this.listeners) listener(this.state); }
  private stop() {
    clearTimeout(this.timer); this.timer = undefined;
    this.controller?.abort(); this.controller = undefined;
  }
  private start() {
    if (this.disposed || this.blocked || !this.state.sessionId || !this.viewers.size || this.controller || this.timer) return;
    void this.poll();
  }
  private async poll() {
    const session = this.state.sessionId!;
    const controller = this.controller = new AbortController();
    let delay = 1000;
    try {
      const response = await this.fetcher(`/api/eve/session/${encodeURIComponent(session)}/browser/frame`, {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      if (Number(response.headers.get('content-length')) > 1_500_000) throw new Error('Browser frame exceeded the size limit.');
      const raw = await response.text();
      if (raw.length > 1_500_000) throw new Error('Browser frame exceeded the size limit.');
      const value = JSON.parse(raw);
      if (controller.signal.aborted || session !== this.state.sessionId) return;
      if (!response.ok) {
        if (response.status === 401) { this.state.frame = null; this.blocked = true; }
        throw new Error(typeof value.error === 'string' ? value.error : 'The browser viewer is unavailable.');
      }
      let frame: BrowserFrame | null = null;
      if (value.frame !== null && value.frame !== undefined) {
        const incoming = value.frame;
        if (typeof incoming.data !== 'string' || incoming.data.length > 1_400_000 || !/^[A-Za-z0-9+/=]+$/.test(incoming.data)
          || !Number.isFinite(incoming.capturedAt) || !Number.isFinite(incoming.receivedAt) || !Number.isSafeInteger(incoming.seq)) throw new Error('The browser sent an invalid frame.');
        frame = incoming;
      }
      this.state.frame = frame ?? this.state.frame;
      this.state.connected = value.connected === true;
      this.state.url = typeof value.url === 'string' ? value.url.slice(0, 2048) : '';
      this.state.message = frame ? (this.state.connected ? 'Watching Eve’s browser · Read only' : 'Last browser frame · Reconnecting')
        : `${this.state.frame ? 'Last browser frame. ' : ''}${typeof value.message === 'string' ? value.message : 'Waiting for the first browser frame.'}`;
    } catch (error) {
      if (controller.signal.aborted) return;
      this.state.connected = false;
      this.state.message = `${this.state.frame ? 'Last browser frame. ' : ''}${error instanceof Error ? error.message : 'Browser connection interrupted.'}`;
      delay = 3000;
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
        if (!controller.signal.aborted) {
          this.emit();
          if (!this.blocked && !this.disposed && this.viewers.size) this.timer = setTimeout(() => { this.timer = undefined; this.start(); }, delay);
        }
      }
    }
  }
  dispose() { this.disposed = true; this.stop(); this.stopEve(); this.listeners.clear(); this.viewers.clear(); }
}

