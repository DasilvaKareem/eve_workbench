import test from 'node:test';
import assert from 'node:assert/strict';
import { init, use } from 'echarts/core';
import { BarChart, GraphChart } from 'echarts/charts';
import { GraphicComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { EveClient } from '../src/eve-client.ts';
import { taskSnapshot, taskListText, taskChartOption, CHART_WIDTH, CHART_HEIGHT } from '../src/eve-task-charts.ts';

use([BarChart, GraphChart, GraphicComponent, GridComponent, TooltipComponent, SVGRenderer]);
const tasks = [
  { id: 'a', title: 'Design the panels', status: 'done' },
  { id: 'b', title: 'Test hand interaction', status: 'in_progress' },
  { id: 'c', title: 'Review chart readability', status: 'todo' },
];

test('charts reflect real task-board events and clear when the board empties', () => {
  const client = new EveClient();
  client.applyEvent({ type: 'action.result', data: { status: 'completed', result: { toolName: 'task_board', output: { tasks } } } });
  assert.deepEqual(taskSnapshot(client.state.tasks).counts, { todo: 1, in_progress: 1, done: 1 });
  assert.equal(taskSnapshot(client.state.tasks).summary, '1 of 3 complete · 1 in progress · 1 to do');
  client.applyEvent({ type: 'action.result', data: { status: 'completed', result: { toolName: 'task_board', output: { tasks: [] } } } });
  assert.equal(taskSnapshot(client.state.tasks).total, 0);
  assert.match(taskListText(client.state.tasks), /No tasks yet/);
  client.dispose();
});

test('map pages bound node count and show status membership without fabricated dependencies', () => {
  const many = Array.from({ length: 19 }, (_, index) => ({ id: String(index), title: `Task ${index}`, status: tasks[index % 3].status }));
  const snapshot = taskSnapshot(many, 99);
  assert.equal(snapshot.page, 3);
  assert.equal(snapshot.pageCount, 4);
  assert.equal(snapshot.tasks.length, 1);
  const series = taskChartOption(many, 'map', 1).series[0];
  assert.equal(series.data.length, 9);
  assert.equal(series.links.length, 6);
  for (const link of series.links) assert.match(link.source, /^status:/);
  const original = tasks.map(task => task.id);
  const ordered = taskChartOption(tasks, 'map').series[0];
  assert.deepEqual(ordered.data.slice(3).map(node => node.name), ['Review chart readability', 'Test hand interaction', 'Design the panels']);
  assert.deepEqual(tasks.map(task => task.id), original);
  assert.equal(taskSnapshot([], 99).page, 0);
  assert.equal(taskSnapshot([], 99).pageCount, 1);
});

test('task text preserves full long titles and unicode for native readable pagination', () => {
  const title = '🌍 <project> ' + 'Long task title '.repeat(100);
  const source = [{ id: 'long', title, status: 'todo' }];
  assert.ok(taskListText(source).includes(title));
  const label = taskChartOption(source, 'map').series[0].data[3].label.formatter();
  assert.ok(label.endsWith('…'));
  assert.ok(!label.includes('\uFFFD'));
});

test('ECharts actually renders empty, progress, and paged task-map options', () => {
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: CHART_WIDTH, height: CHART_HEIGHT });
  try {
    for (const [source, view, expected] of [[[], 'progress', 'Your task board is empty'], [tasks, 'progress', 'In progress'], [tasks, 'map', 'Design the panels']]) {
      chart.setOption(taskChartOption(source, view), { notMerge: true });
      const svg = chart.renderToSVGString();
      assert.match(svg, /<svg/);
      assert.ok(svg.includes(expected));
      assert.ok(!svg.includes('NaN'));
      assert.ok(!svg.includes('undefined'));
    }
  } finally { chart.dispose(); }
});
