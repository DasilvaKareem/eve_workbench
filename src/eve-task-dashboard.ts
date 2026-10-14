import { eve } from './eve-client.js';
import { taskSnapshot, type TaskChartView } from './eve-task-charts.js';
import type { TaskChartSurface } from './eve-task-chart-surface.js';

export function mountTaskDashboard(board: HTMLDetailsElement) {
  const host = document.createElement('div');
  host.className = 'eve-task-dashboard';
  host.innerHTML = `<div class="eve-task-tabs" role="group" aria-label="Task visualization">
    <button type="button" data-chart="progress" aria-pressed="true">Progress</button>
    <button type="button" data-chart="map" aria-pressed="false">Task map</button>
  </div><p class="eve-task-summary"></p>
  <div class="eve-task-chart" role="img" aria-label="Task status chart"><canvas></canvas></div>
  <p class="eve-task-chart-status" role="status">Open the task board to load its chart.</p>
  <div class="eve-task-pages"><button type="button" data-page="previous">Previous tasks</button><span></span><button type="button" data-page="next">Next tasks</button></div>
  <p class="eve-task-caption">Live task-board data. Map lines show each task’s status.</p>`;
  board.insertBefore(host, board.querySelector('ul'));
  const summary = host.querySelector<HTMLParagraphElement>('.eve-task-summary')!;
  const status = host.querySelector<HTMLParagraphElement>('.eve-task-chart-status')!;
  const pagination = host.querySelector<HTMLDivElement>('.eve-task-pages')!;
  const previous = host.querySelector<HTMLButtonElement>('[data-page="previous"]')!;
  const next = host.querySelector<HTMLButtonElement>('[data-page="next"]')!;
  const canvas = host.querySelector('canvas')!;
  let surface: TaskChartSurface | undefined;
  let view: TaskChartView = 'progress';
  let page = 0;
  let loading = false;
  let disposed = false;
  let session = eve.state.sessionId;
  const update = () => {
    const snapshot = taskSnapshot(eve.state.tasks, page);
    page = snapshot.page;
    summary.textContent = snapshot.summary;
    host.querySelector('.eve-task-chart')!.setAttribute('aria-label', `${view === 'progress' ? 'Progress chart' : 'Task status map'}. ${snapshot.summary}. Full task list follows.`);
    pagination.hidden = view !== 'map' || snapshot.pageCount === 1;
    pagination.querySelector('span')!.textContent = `${page + 1} / ${snapshot.pageCount}`;
    previous.disabled = page === 0;
    next.disabled = page === snapshot.pageCount - 1;
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-chart]')) button.setAttribute('aria-pressed', String(button.dataset.chart === view));
    if (board.open) surface?.update(eve.state.tasks, view, page);
  };
  const load = async () => {
    if (!board.open || loading || surface || disposed) return;
    loading = true;
    status.textContent = 'Loading chart…';
    try {
      const { createTaskChartSurface } = await import('./eve-task-chart-surface.js');
      if (disposed) return;
      surface = createTaskChartSurface(canvas);
      status.hidden = true;
      update();
    } catch (error) {
      status.hidden = false;
      status.textContent = 'Chart unavailable. The complete task list is below. Reopen to retry.';
      console.error('Task chart could not load:', error);
    } finally { loading = false; }
  };
  const onToggle = () => { update(); void load(); };
  const onClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target) return;
    if (target.dataset.chart) { view = target.dataset.chart as TaskChartView; page = 0; }
    if (target.dataset.page === 'previous') page--;
    if (target.dataset.page === 'next') page++;
    update();
  };
  host.addEventListener('click', onClick);
  board.addEventListener('toggle', onToggle);
  const unsubscribe = eve.subscribe(state => {
    if (session !== state.sessionId) { session = state.sessionId; page = 0; }
    update();
  });
  void load();
  return () => {
    disposed = true;
    unsubscribe();
    board.removeEventListener('toggle', onToggle);
    host.removeEventListener('click', onClick);
    surface?.dispose();
    host.remove();
  };
}
