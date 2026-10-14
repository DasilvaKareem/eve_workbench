import { eve } from './eve-client.js';
import { panelBlockText } from './eve-generated-content.js';
import type { WorkbenchPanel } from '../shared/workbench-panels.js';
import type { createGeneratedChartSurface } from './eve-task-chart-surface.js';

export function mountGeneratedPanels(board: HTMLDetailsElement) {
  const tabs = document.createElement('div'); tabs.className = 'eve-panel-tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Generated panels');
  const content = document.createElement('section'); content.className = 'eve-generated-content';
  const notice = document.createElement('p'); notice.className = 'eve-panel-notice'; notice.setAttribute('role', 'status');
  board.append(tabs, content, notice);
  let selected = '', key = '', revision = 0, disposed = false;
  let surfaces: ReturnType<typeof createGeneratedChartSurface>[] = [];
  const clearCharts = () => { for (const surface of surfaces) surface.dispose(); surfaces = []; };
  const render = () => {
    const panels = eve.state.panels;
    if (!panels.some(panel => panel.id === selected)) selected = panels.slice(-1)[0]?.id || '';
    tabs.replaceChildren();
    for (const panel of panels) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = panel.title;
      tab.setAttribute('aria-pressed', String(panel.id === selected));
      tab.addEventListener('click', () => { selected = panel.id; render(); }); tabs.append(tab);
    }
    const current = panels.find(panel => panel.id === selected);
    clearCharts(); content.replaceChildren(); notice.textContent = '';
    const currentRevision = ++revision;
    if (!current) { content.textContent = 'Ask Eve to show a comparison, dashboard, or chart.'; return; }
    const heading = document.createElement('h3'); heading.textContent = current.title; content.append(heading);
    const charts: { canvas: HTMLCanvasElement; block: Extract<WorkbenchPanel['blocks'][number], { type: 'chart' }> }[] = [];
    for (const block of current.blocks) {
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
        const data = document.createElement('details'), label = document.createElement('summary'), text = document.createElement('pre');
        label.textContent = 'Read chart data'; text.textContent = panelBlockText(block); data.append(label, text); figure.append(canvas, data); content.append(figure); charts.push({ canvas, block });
      } else { const text = document.createElement('p'); text.className = 'eve-panel-text'; text.textContent = block.text; content.append(text); }
    }
    const actions = document.createElement('div'); actions.className = 'eve-panel-actions';
    for (const action of current.actions) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label;
      button.disabled = !['ready', 'waiting'].includes(eve.state.phase);
      button.addEventListener('click', () => { if (['ready', 'waiting'].includes(eve.state.phase)) void eve.send(action.prompt); }); actions.append(button);
    }
    content.append(actions);
    if (charts.length && board.open) void import('./eve-task-chart-surface.js').then(({ createGeneratedChartSurface }) => {
      if (disposed || currentRevision !== revision) return;
      try { for (const { canvas, block } of charts) { const surface = createGeneratedChartSurface(canvas); surfaces.push(surface); surface.update(block); } }
      catch { clearCharts(); notice.textContent = 'Chart unavailable. Use Read chart data.'; }
    }).catch(() => { if (!disposed && currentRevision === revision) notice.textContent = 'Chart unavailable. Use Read chart data.'; });
  };
  const stop = eve.subscribe(state => {
    for (const button of content.querySelectorAll<HTMLButtonElement>('.eve-panel-actions button')) button.disabled = !['ready', 'waiting'].includes(state.phase);
    const next = JSON.stringify(state.panels);
    if (next === key) return;
    key = next;
    selected = state.panels.slice(-1)[0]?.id || '';
    board.querySelector('summary')!.textContent = `Eve panels${state.panels.length ? ` · ${state.panels.length}` : ''}`;
    if (state.panels.length) board.open = true;
    render();
  });
  board.addEventListener('toggle', render);
  return () => { disposed = true; revision++; stop(); clearCharts(); board.removeEventListener('toggle', render); tabs.remove(); content.remove(); notice.remove(); };
}
