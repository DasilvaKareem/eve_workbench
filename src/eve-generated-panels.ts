import { eve } from './eve-client.js';
import { workspaceWindows } from './eve-windows.ts';
import { panelBlockText } from './eve-generated-content.js';
import type { WorkbenchPanel } from '../shared/workbench-panels.js';
import type { createGeneratedChartSurface } from './eve-task-chart-surface.js';

export function mountInlinePanel(content: HTMLElement, panel: WorkbenchPanel, onLayout?: () => void, allowOpenWindow = true) {
  content.classList.add('eve-generated-content', 'eve-inline-panel');
  content.dataset.panelId = panel.id;
  content.setAttribute('aria-label', panel.title);
  const heading = document.createElement('h3'); heading.textContent = panel.title; content.append(heading);
  const notice = document.createElement('p'); notice.className = 'eve-panel-notice'; notice.setAttribute('role', 'status');
  let disposed = false;
  const surfaces: ReturnType<typeof createGeneratedChartSurface>[] = [];
  const clearCharts = () => { for (const surface of surfaces) surface.dispose(); surfaces.length = 0; };
    const charts: { canvas: HTMLCanvasElement; block: Extract<WorkbenchPanel['blocks'][number], { type: 'chart' }> }[] = [];
    for (const block of panel.blocks) {
      if (block.type === 'metrics') {
        const group = document.createElement('dl'); group.className = 'eve-panel-metrics';
        for (const metric of block.items) {
          const card = document.createElement('div'); const label = document.createElement('dt'), value = document.createElement('dd');
          label.textContent = metric.label; value.textContent = metric.value; card.append(label, value); group.append(card);
        }
        content.append(group);
      } else if (block.type === 'table') {
        const wrap = document.createElement('div'); wrap.className = 'eve-panel-table';
        const table = document.createElement('table'), head = document.createElement('thead'), header = document.createElement('tr'), body = document.createElement('tbody');
        for (const column of block.columns) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = column; header.append(cell); }
        head.append(header);
        for (const row of block.rows) { const tr = document.createElement('tr'); for (const value of row) { const cell = document.createElement('td'); cell.textContent = value; tr.append(cell); } body.append(tr); }
        table.append(head, body); wrap.append(table); content.append(wrap);
      } else if (block.type === 'chart') {
        const figure = document.createElement('figure'); figure.className = 'eve-generated-chart';
        const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${block.kind} chart: ${block.series.map(series => series.name).join(', ')}. Complete data follows.`);
        const data = document.createElement('div'), label = document.createElement('span'), text = document.createElement('pre');
        label.textContent = 'Chart data'; text.textContent = panelBlockText(block); data.append(label, text); figure.append(canvas, data); content.append(figure); charts.push({ canvas, block });
      } else { const text = document.createElement('p'); text.className = 'eve-panel-text'; text.textContent = block.text; content.append(text); }
    }

  const actions = document.createElement('div'); actions.className = 'eve-panel-actions';
  if (allowOpenWindow) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Open window';
    button.addEventListener('click', () => workspaceWindows.open(panel.id)); actions.append(button);
  }
  for (const action of panel.actions) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label;
    button.addEventListener('click', () => { if (['ready', 'waiting'].includes(eve.state.phase)) void eve.send(action.prompt); });
    actions.append(button);
  }
  content.append(actions, notice);
  const refresh = () => {
    const state = eve.state;
    for (const button of actions.querySelectorAll<HTMLButtonElement>('button')) button.disabled = button.textContent === 'Open window' ? workspaceWindows.contentCount >= 6 && !workspaceWindows.entries.some(entry => entry.panel?.id === panel.id) : !['ready', 'waiting'].includes(state.phase);
  };
  const stop = eve.subscribe(refresh), stopWindows = workspaceWindows.subscribe(refresh);
  if (charts.length) void import('./eve-task-chart-surface.js').then(({ createGeneratedChartSurface }) => {
    if (disposed) return;
    try { for (const { canvas, block } of charts) { const surface = createGeneratedChartSurface(canvas); surfaces.push(surface); surface.update(block); } }
    catch { clearCharts(); notice.textContent = 'Chart unavailable. Complete data is shown below it.'; }
    onLayout?.();
  }).catch(() => { if (!disposed) notice.textContent = 'Chart unavailable. Complete data is shown below it.'; });
  return () => { disposed = true; stop(); stopWindows(); clearCharts(); };
}
