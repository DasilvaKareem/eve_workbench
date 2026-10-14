import type { EChartsOption } from 'echarts';
import type { EveState } from './eve-client.js';

export type WorkbenchTask = EveState['tasks'][number];
export type TaskChartView = 'progress' | 'map';
export const TASKS_PER_PAGE = 6;
export const CHART_WIDTH = 1104;
export const CHART_HEIGHT = 540;
const statuses = ['todo', 'in_progress', 'done'] as const;
const names = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
const colors = { todo: '#8fa5a0', in_progress: '#e8bc78', done: '#d6f29a' };

export function taskSnapshot(tasks: readonly WorkbenchTask[], requestedPage = 0) {
  const counts = { todo: 0, in_progress: 0, done: 0 };
  for (const task of tasks) counts[task.status]++;
  const pageCount = Math.max(1, Math.ceil(tasks.length / TASKS_PER_PAGE));
  const page = Math.max(0, Math.min(Math.trunc(requestedPage) || 0, pageCount - 1));
  return {
    counts, total: tasks.length, page, pageCount,
    tasks: tasks.slice(page * TASKS_PER_PAGE, (page + 1) * TASKS_PER_PAGE),
    summary: tasks.length ? `${counts.done} of ${tasks.length} complete · ${counts.in_progress} in progress · ${counts.todo} to do` : 'No tasks yet. Ask Eve to make a plan.',
  };
}

export function taskListText(tasks: readonly WorkbenchTask[]) {
  return tasks.length
    ? tasks.map((task, index) => `${index + 1}. ${task.title}\n${names[task.status]}`).join('\n\n')
    : 'No tasks yet. Ask Eve to make a plan, then its task board will appear here.';
}

export function taskChartOption(tasks: readonly WorkbenchTask[], view: TaskChartView, page = 0): EChartsOption {
  const snapshot = taskSnapshot(tasks, page);
  const base: EChartsOption = {
    animation: false,
    backgroundColor: '#151d21',
    textStyle: { fontFamily: 'sans-serif', color: '#f3f3ee', fontSize: 30 },
    tooltip: { trigger: 'item', renderMode: 'richText', textStyle: { fontSize: 24 }, backgroundColor: '#29352f', borderColor: '#60756a' },
  };
  if (!tasks.length) return {
    ...base,
    graphic: [
      { type: 'text', left: 'center', top: '38%', style: { text: 'Your task board is empty', fill: '#f3f3ee', font: '36px sans-serif' } },
      { type: 'text', left: 'center', top: '53%', style: { text: 'Make a plan with Eve to get started.', fill: '#b6c7bd', font: '28px sans-serif' } },
    ],
  };
  if (view === 'progress') return {
    ...base,
    grid: { left: 200, right: 100, top: 45, bottom: 65 },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 26, color: '#b6c7bd' }, splitLine: { lineStyle: { color: '#314139' } } },
    yAxis: { type: 'category', inverse: true, data: statuses.map(status => names[status]), axisLabel: { fontSize: 30, color: '#f3f3ee', margin: 22 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: 'bar', barMaxWidth: 64,
      data: statuses.map(status => ({ value: snapshot.counts[status], itemStyle: { color: colors[status], borderRadius: 8 } })),
      label: { show: true, position: 'right', color: '#f3f3ee', fontSize: 34, distance: 16 },
    }],
  };

  // These connections represent status membership, never inferred dependencies.
  const categories = statuses.map((status, index) => ({
    id: `status:${status}`, name: names[status], x: 0, y: 60 + index * 180,
    symbol: 'roundRect', symbolSize: [170, 58],
    itemStyle: { color: colors[status] }, label: { color: '#17201b', fontSize: 24 },
  }));
  const mapTasks = [...snapshot.tasks].sort((a, b) => statuses.indexOf(a.status) - statuses.indexOf(b.status));
  const nodes = mapTasks.map((task, index) => ({
    id: `task:${snapshot.page * TASKS_PER_PAGE + index}`, name: task.title,
    x: 600, y: mapTasks.length === 1 ? 240 : 30 + index * 420 / (mapTasks.length - 1),
    symbol: 'roundRect', symbolSize: [600, 62],
    itemStyle: { color: '#29352f', borderColor: colors[task.status], borderWidth: 2 },
    label: { color: '#f3f3ee', fontSize: 28, formatter: () => {
      const title = Array.from(task.title);
      return title.length > 35 ? `${title.slice(0, 34).join('')}…` : task.title;
    } },
  }));
  return {
    ...base,
    series: [{
      type: 'graph', layout: 'none', roam: false, draggable: false,
      left: 120, right: 380, top: 60, bottom: 60,
      data: [...categories, ...nodes],
      links: mapTasks.map((task, index) => ({
        source: `status:${task.status}`, target: nodes[index].id,
        lineStyle: { color: colors[task.status], width: 3, opacity: 0.8 },
      })),
      label: { show: true, position: 'inside' },
      emphasis: { focus: 'adjacency' },
    }],
  };
}
