import { eve, type EveClient, type EveEvent, type EveState } from './eve-client.ts';
import { parseWorkbenchPanels, type WorkbenchPanel } from '../shared/workbench-panels.ts';

export interface WorkspaceWindow { id: string; panel?: WorkbenchPanel; kind?: 'integrations' }

/** Window placement is local to the workspace; panel data belongs to the conversation. */
export class WorkspaceWindows {
  readonly entries: WorkspaceWindow[] = [];
  private listeners = new Set<() => void>();
  private pendingId: string | undefined;
  private sessionId: string | null = null;
  private stops: (() => void)[];
  private client: EveClient;
  constructor(client: EveClient) {
    this.client = client;
    this.stops = [client.subscribe(state => this.sync(state)), client.subscribeEvents(event => this.event(event))];
  }
  subscribe(listener: () => void) { this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  get contentCount() { return this.entries.filter(entry => !entry.kind).length; }
  openIntegrations() {
    if (!this.entries.some(entry => entry.kind === 'integrations')) this.entries.push({ id: 'eve-integrations', kind: 'integrations' });
    this.emit(); return 'eve-integrations';
  }
  create() {
    if (this.contentCount >= 6) return;
    const entry = { id: crypto.randomUUID() }; this.entries.push(entry); this.pendingId = entry.id; this.emit(); return entry.id;
  }
  close(id: string) {
    const index = this.entries.findIndex(entry => entry.id === id);
    if (index < 0) return;
    this.entries.splice(index, 1); if (this.pendingId === id) this.pendingId = this.entries.find(entry => !entry.panel && !entry.kind)?.id; this.emit();
  }
  open(panelId: string) {
    const panel = this.client.state.panels.find(panel => panel.id === panelId); if (!panel) return;
    let entry = this.entries.find(entry => entry.panel?.id === panelId);
    if (!entry) entry = this.entries.find(entry => entry.id === this.pendingId);
    if (!entry) { if (this.contentCount >= 6) return; entry = { id: crypto.randomUUID() }; this.entries.push(entry); }
    entry.panel = panel; if (entry.id === this.pendingId) this.pendingId = this.entries.find(entry => !entry.panel && !entry.kind)?.id; this.emit(); return entry.id;
  }
  private sync(state: EveState) {
    if (this.sessionId && this.sessionId !== state.sessionId) { this.entries.length = 0; this.pendingId = undefined; }
    this.sessionId = state.sessionId;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]; if (!entry.panel) continue;
      const panel = state.panels.find(panel => panel.id === entry.panel!.id);
      if (panel) entry.panel = panel; else this.entries.splice(i, 1);
    }
    this.emit();
  }
  private event(event: EveEvent) {
    const result = event.data.result;
    if (event.type === 'action.result' && event.data.status === 'completed' && !result?.isError && result?.toolName === 'workbench_integrations' && result.output?.openIntegrations === true) this.openIntegrations();
    if (event.type !== 'action.result' || event.data.status !== 'completed' || result?.isError || result?.toolName !== 'workbench_panel') return;
    const output = result.output;
    if (!parseWorkbenchPanels(output?.panels)) return;
    const id = output?.openWindowId || (this.pendingId && output?.updatedPanelId);
    if (typeof id === 'string') this.open(id);
  }
  dispose() { for (const stop of this.stops) stop(); this.listeners.clear(); this.entries.length = 0; }
}

export const workspaceWindows = new WorkspaceWindows(eve);
