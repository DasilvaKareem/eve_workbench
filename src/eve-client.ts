export type Phase = 'connecting' | 'setup' | 'locked' | 'ready' | 'working' | 'waiting' | 'error';
import { parseWorkbenchPanels, type WorkbenchPanel } from '../shared/workbench-panels.ts';

export interface Message { id: string; role: 'user' | 'assistant'; text: string; pending?: boolean }
export interface InputRequest { id: string; title: string; options: { id: string; label: string }[] }
export interface BrowserAction { id: string; tool: string; status: 'running' | 'completed' | 'failed' | 'cancelled' }
export interface EveState {
  phase: Phase; sessionId: string | null; messages: Message[];
  activity: string; error: string | null; inputs: InputRequest[]; authRequired: boolean;
  tasks: { id: string; title: string; status: 'todo' | 'in_progress' | 'done' }[];
  browserActions: BrowserAction[];
  panels: WorkbenchPanel[];
}
export interface EveEvent { type: string; data: Record<string, any>; meta?: { id?: string; at?: string } }

const SESSION_KEY = 'eve-workbench.session.v1';
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal.addEventListener('abort', onAbort, { once: true });
});

export class EveError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message); this.code = code; this.status = status;
  }
}

/** A single session store shared by the desktop UI and the XR console. */
export class EveClient {
  state: EveState = { phase: 'connecting', sessionId: null, messages: [], activity: 'Checking connection', error: null, inputs: [], authRequired: false, tasks: [], browserActions: [], panels: [] };
  private listeners = new Set<(state: EveState) => void>();
  private eventListeners = new Set<(event: EveEvent, live: boolean) => void>();
  private liveTurns = new Set<string>();
  private streamController: AbortController | null = null;
  private requestController = new AbortController();
  private cursor = 0;
  private seen = new Set<string>();
  private activeTurn: string | null = null;
  private sendInFlight = false;
  private terminal = false;
  private fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) { this.fetcher = fetcher; }

  subscribe(listener: (state: EveState) => void): () => void {
    this.listeners.add(listener); listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit() { for (const listener of this.listeners) listener(this.state); }
  /** Live means this tab submitted the turn; replayed history stays silent. */
  subscribeEvents(listener: (event: EveEvent, live: boolean) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  private patch(value: Partial<EveState>) { Object.assign(this.state, value); this.emit(); }

  private async request(path: string, options: RequestInit = {}) {
    const response = await this.fetcher(`/api/eve${path}`, { credentials: 'same-origin', ...options,
      signal: options.signal ?? AbortSignal.any([this.requestController.signal, AbortSignal.timeout(25_000)]) });
    if (!response.ok) {
      let body: { error?: string; code?: string } = {};
      try { body = await response.json(); } catch { /* Non-JSON infrastructure errors. */ }
      throw new EveError(body.error || `The agent returned HTTP ${response.status}.`, body.code || 'request_failed', response.status);
    }
    return response;
  }

  async connect() {
    this.patch({ phase: 'connecting', error: null, activity: 'Checking connection' });
    try {
      const status = await (await this.request('/status')).json();
      this.state.authRequired = Boolean(status.authRequired);
      if (!status.configured) {
        this.patch({ phase: 'setup', activity: 'Backend setup required', error: 'Configure the Eve backend using docs/eve-integration.md.' }); return;
      }
      if (!status.authenticated) { this.patch({ phase: 'locked', activity: 'Private workspace' }); return; }
      const health = await (await this.request('/health')).json();
      if (health.ok !== true || health.status !== 'ready') throw new Error('The Eve backend is not ready yet.');
      this.patch({ phase: 'ready', activity: 'Eve is ready' });
      if (this.terminal) { await this.newConversation(); return; }
      if (!this.state.sessionId) {
        let saved: string | null = null;
        try { saved = localStorage.getItem(SESSION_KEY); } catch { /* Storage can be disabled. */ }
        if (saved && /^[A-Za-z0-9_-]{1,200}$/.test(saved)) {
          this.state.sessionId = saved;
          this.patch({ phase: 'connecting', activity: 'Restoring your conversation' });
          this.follow();
        }
      } else if (!this.streamController) this.follow();
    } catch (error) { this.fail(error); }
  }

  async unlock(accessCode: string) {
    try {
      await this.request('/access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode }) });
      await this.connect();
    } catch (error) { this.fail(error); }
  }

  async send(text: string) {
    const message = text.trim();
    if (!message || this.sendInFlight || !['ready', 'waiting'].includes(this.state.phase)) return;
    if (message.length > 12_000) { this.patch({ error: 'Keep messages under 12,000 characters.' }); return; }
    this.sendInFlight = true;
    const optimistic = { id: crypto.randomUUID(), role: 'user' as const, text: message, pending: true };
    this.state.messages.push(optimistic);
    this.patch({ phase: 'working', activity: 'Sending to Eve', error: null });
    try {
      const path = this.state.sessionId ? `/session/${encodeURIComponent(this.state.sessionId)}` : '/session';
      const result = await this.postWithRetry(path, { message });
      if (!this.state.sessionId) {
        if (typeof result.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result.sessionId)) throw new Error('Eve did not return a valid session ID.');
        this.state.sessionId = result.sessionId;
        try { localStorage.setItem(SESSION_KEY, result.sessionId); } catch { /* Optional persistence. */ }
        this.cursor = 0; this.seen.clear(); this.terminal = false;
        this.follow();
      }
      if (!this.streamController && !this.terminal) this.follow();
      this.patch({ activity: 'Eve is working' });
    } catch (error) {
      this.state.messages = this.state.messages.filter(item => item !== optimistic);
      this.fail(error);
    } finally { this.sendInFlight = false; }
  }

  private async postWithRetry(path: string, payload: object) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await (await this.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).json();
      } catch (error) {
        if (!(error instanceof EveError) || error.code !== 'session_not_ready' || attempt >= 5) throw error;
        await sleep(Math.min(400 * 2 ** attempt, 4000), this.requestController.signal);
      }
    }
  }

  async answer(requestId: string, optionId: string) {
    if (!this.state.sessionId || this.sendInFlight) return;
    this.sendInFlight = true;
    try {
      await this.postWithRetry(`/session/${this.state.sessionId}`, { inputResponses: [{ requestId, optionId }] });
      if (this.activeTurn) this.liveTurns.add(this.activeTurn);
      this.state.inputs = this.state.inputs.filter(input => input.id !== requestId);
      this.patch({ phase: 'working', activity: 'Continuing your task', error: null });
    } catch (error) { this.fail(error); }
    finally { this.sendInFlight = false; }
  }

  async cancel() {
    if (!this.state.sessionId || !['working', 'waiting'].includes(this.state.phase)) return;
    try {
      await this.postWithRetry(`/session/${this.state.sessionId}/cancel`, this.activeTurn ? { turnId: this.activeTurn } : {});
      this.patch({ activity: 'Cancellation requested' });
    } catch (error) { this.fail(error); }
  }

  async newConversation() {
    if (this.state.phase === 'working' || this.sendInFlight) return;
    if (!this.state.sessionId) { await this.connect(); return; }
    if (this.state.sessionId && !this.terminal) {
      try { await this.postWithRetry(`/session/${this.state.sessionId}/reset`, {}); }
      catch (error) {
        if (!(error instanceof EveError) || !['session_not_active', 'session_expired'].includes(error.code)) { this.fail(error); return; }
      }
    }
    this.streamController?.abort(); this.streamController = null;
    this.cursor = 0; this.seen.clear(); this.activeTurn = null; this.terminal = false;
    try { localStorage.removeItem(SESSION_KEY); } catch { /* Optional persistence. */ }
    this.liveTurns.clear();
    this.patch({ sessionId: null, messages: [], inputs: [], tasks: [], browserActions: [], panels: [], phase: 'ready', activity: 'A fresh conversation', error: null });
  }

  private follow() {
    this.streamController?.abort();
    const controller = new AbortController();
    this.streamController = controller;
    void this.readStream(controller).catch(error => {
      if (!controller.signal.aborted) this.fail(error);
    }).finally(() => { if (this.streamController === controller) this.streamController = null; });
  }

  private async readStream(controller: AbortController) {
    let retries = 0;
    while (!controller.signal.aborted && !this.terminal && this.state.sessionId) {
      try {
        const response = await this.request(`/session/${this.state.sessionId}/stream?startIndex=${this.cursor}`, { signal: controller.signal });
        const version = Number(response.headers.get('x-eve-stream-version'));
        if (![25, 26].includes(version)) throw new EveError('This workbench requires Eve stream protocol v25 or v26. Update the Eve backend.', 'unsupported_stream', 502);
        if (!response.body) throw new Error('The agent did not return an event stream.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const consume = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as EveEvent;
          if (typeof event.type !== 'string' || !event.data) throw new Error('Eve sent an invalid event.');
          this.cursor++; retries = 0;
          if (event.meta?.id && this.seen.has(event.meta.id)) return;
          if (event.meta?.id) this.seen.add(event.meta.id);
          this.applyEvent(event);
        };
        try {
          while (!controller.signal.aborted && !this.terminal) {
            const { value, done } = await reader.read();
            if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); retries = 0; break; }
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 2_000_000) throw new Error('The agent event exceeded the supported size.');
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); consume(line);
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof EveError && (error.status === 401 || error.status === 410 || ['unsupported_stream', 'session_stranded', 'session_not_active'].includes(error.code))) {
          if (['session_expired', 'session_not_active', 'session_stranded'].includes(error.code)) this.terminal = true;
          throw error;
        }
        if (retries >= 5) throw error;
        this.patch({ activity: 'Reconnecting to Eve', error: 'Connection interrupted. Reconnecting…' });
      }
      if (!controller.signal.aborted && !this.terminal) {
        if (++retries > 6) throw new Error('The agent stream disconnected repeatedly. Retry the connection.');
        await sleep(Math.min(500 * 2 ** (retries - 1), 8000), controller.signal);
      }
    }
  }

  /** Protocol reducer: completed messages replace their matching streamed block. */
  applyEvent(event: EveEvent) {
    const data = event.data;
    switch (event.type) {
      case 'turn.started':
        this.activeTurn = data.turnId;
        Object.assign(this.state, { phase: 'working', activity: 'Eve is working', error: null }); break;
      case 'message.received': {
        const text = typeof data.message === 'string' ? data.message : '';
        if (text) {
          const pending = this.state.messages.find(message => message.role === 'user' && message.pending && message.text === text);
          if (pending) { pending.pending = false; this.liveTurns.add(data.turnId); }
          else this.state.messages.push({ id: event.meta?.id || crypto.randomUUID(), role: 'user', text });
        }
        break;
      }
      case 'message.appended':
      case 'message.completed': {
        // sequence counts stream events; it changes between deltas in one block.
        const id = `${data.turnId}:${data.stepIndex}`;
        let message = this.state.messages.find(item => item.id === id);
        if (!message) { message = { id, role: 'assistant', text: '' }; this.state.messages.push(message); }
        if (event.type === 'message.completed') message.text = typeof data.message === 'string' ? data.message : message.text;
        else if (typeof data.messageDelta === 'string') message.text += data.messageDelta;
        this.state.activity = 'Eve is responding'; this.state.error = null;
        break;
      }
      case 'actions.requested': {
        this.state.activity = 'Eve is using tools';
        for (const action of Array.isArray(data.actions) ? data.actions : []) {
          if (typeof action.toolName !== 'string' || !(action.toolName === 'browser' || action.toolName.startsWith('browser__')) || typeof action.callId !== 'string') continue;
          const id = `${data.turnId}:${action.callId}`;
          const tool = action.toolName === 'browser' ? String(action.input?.operation || 'browser').slice(0, 40) : action.toolName.slice(9).replaceAll('_', ' ');
          if (!this.state.browserActions.some(item => item.id === id)) this.state.browserActions.push({ id, tool, status: 'running' });
        }
        this.state.browserActions = this.state.browserActions.slice(-30);
        break;
      }
      case 'action.result': {
        const result = data.result;
        const action = this.state.browserActions.find(item => item.id === `${data.turnId}:${result?.callId}`);
        if (action) action.status = data.status === 'completed' && !result?.isError ? 'completed' : data.status === 'cancelled' ? 'cancelled' : 'failed';
        if (data.status === 'completed' && result?.toolName === 'task_board' && Array.isArray(result.output?.tasks)) {
          this.state.tasks = result.output.tasks.filter((task: any) => typeof task.id === 'string'
            && typeof task.title === 'string' && ['todo', 'in_progress', 'done'].includes(task.status));
        }
        if (data.status === 'completed' && !result?.isError && result?.toolName === 'workbench_panel') {
          const panels = parseWorkbenchPanels(result.output?.panels);
          if (panels) this.state.panels = panels;
        }
        break;
      }
      case 'task.started': this.state.activity = `Running ${String(data.name || 'task')}`; break;
      case 'input.requested': {
        const incoming: InputRequest[] = (Array.isArray(data.requests) ? data.requests : []).map((input: any) => ({
          id: input.requestId,
          title: String(input.prompt || 'Eve needs your input'),
          options: (Array.isArray(input.options) ? input.options : []).map((option: any) => ({ id: option.id, label: String(option.label || option.id) })),
        })).filter((input: InputRequest) => typeof input.id === 'string');
        this.state.inputs = [...new Map([...this.state.inputs, ...incoming].map(input => [input.id, input])).values()];
        Object.assign(this.state, { phase: 'waiting', activity: 'Your input is needed' }); break;
      }
      case 'input.resolved': {
        const resolved = new Set((data.resolutions || []).map((item: any) => item.requestId));
        this.state.inputs = this.state.inputs.filter(input => !resolved.has(input.id)); break;
      }
      case 'turn.waiting':
        Object.assign(this.state, { phase: data.on === 'input' ? 'waiting' : 'working', activity: data.on === 'input' ? 'Your input is needed' : 'Background tasks are running' }); break;
      case 'authorization.required':
        Object.assign(this.state, { phase: 'waiting', activity: 'Service sign-in required', error: 'Complete the requested connection sign-in in your Eve backend before continuing.' }); break;
      case 'session.waiting':
        Object.assign(this.state, { phase: 'ready', activity: 'Ready for your next idea' }); break;
      case 'turn.cancelled':
        this.state.activity = 'Task cancelled';
        for (const action of this.state.browserActions) if (action.status === 'running') action.status = 'cancelled';
        break;
      case 'turn.failed':
      case 'session.failed':
        for (const action of this.state.browserActions) if (action.status === 'running') action.status = 'failed';
        this.state.error = String(data.message || data.error?.message || 'The agent could not finish this task.');
        this.state.phase = 'error'; this.state.activity = 'Task failed';
        if (event.type === 'session.failed') this.terminal = true;
        break;
      case 'session.completed':
        this.terminal = true;
        Object.assign(this.state, { phase: 'error', activity: 'Conversation ended', error: 'Start a new conversation to continue.' }); break;
    }
    this.emit();
    const live = this.liveTurns.has(data.turnId || this.activeTurn || '');
    for (const listener of this.eventListeners) listener(event, live);
    if (['session.waiting', 'turn.cancelled', 'turn.failed', 'session.failed', 'session.completed'].includes(event.type)) this.liveTurns.clear();
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : 'Cannot connect to Eve.';
    this.patch({ phase: error instanceof EveError && error.status === 401 ? 'locked' : 'error', error: message, activity: 'Connection needs attention' });
  }

  dispose() { this.streamController?.abort(); this.requestController.abort(); this.listeners.clear(); this.eventListeners.clear(); }
}

export const eve = new EveClient();
