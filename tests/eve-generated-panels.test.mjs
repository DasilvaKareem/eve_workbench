import test from 'node:test';
import assert from 'node:assert/strict';
import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { readFileSync } from 'node:fs';
import { parseUIKitMLSource } from '@iwsdk/core';
import { parseWorkbenchPanel, parseWorkbenchPanels } from '../shared/workbench-panels.ts';
import { generatedChartOption, generatedPanelPages, panelBlockText } from '../src/eve-generated-content.ts';
import { EveClient } from '../src/eve-client.ts';

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);
const fixture = () => ({ id: 'comparison', title: 'Project estimates (user supplied)', blocks: [
  { type: 'text', text: 'Compare the two estimates.' },
  { type: 'metrics', items: [{ label: 'Budget', value: '$400' }] },
  { type: 'table', columns: ['Project', 'Hours'], rows: [['Alpha', '3'], ['Beta', '5']] },
  { type: 'chart', kind: 'bar', labels: ['Alpha', 'Beta'], series: [{ name: 'Estimated hours', values: [3, 5] }] },
], actions: [{ label: 'Compare tradeoffs', prompt: 'Explain the tradeoffs between these projects.' }] });

test('a panel result updates shared state immediately; failed or malformed snapshots preserve good data', () => {
  const client = new EveClient();
  const apply = (panels, status = 'completed') => client.applyEvent({ type: 'action.result', data: { status, result: { kind: 'tool-result', toolName: 'workbench_panel', output: { panels } } } });
  try {
    apply([fixture()]);
    assert.equal(client.state.panels[0].id, 'comparison');
    const malformed = fixture(); malformed.blocks[3].series[0].values = [3];
    apply([malformed]);
    assert.equal(client.state.panels[0].blocks[3].series[0].values.length, 2);
    apply([], 'failed'); assert.equal(client.state.panels.length, 1);
    apply([]); assert.equal(client.state.panels.length, 0);
  } finally { client.dispose(); }
});

test('panel validation rejects unsupported execution surfaces and unbounded or inconsistent data', () => {
  assert.equal(parseWorkbenchPanel({ ...fixture(), blocks: [{ type: 'html', html: '<script>bad()</script>' }] }), null);
  for (const value of [NaN, Infinity, 1e20]) {
    const panel = fixture(); panel.blocks[3].series[0].values[0] = value;
    assert.equal(parseWorkbenchPanel(panel), null);
  }
  const uneven = fixture(); uneven.blocks[2].rows[0] = ['only one cell'];
  assert.equal(parseWorkbenchPanel(uneven), null);
  assert.equal(parseWorkbenchPanels([fixture(), fixture()]), null);
  assert.equal(parseWorkbenchPanels(Array.from({ length: 7 }, (_, index) => ({ ...fixture(), id: `p${index}` }))), null);
  const panel = fixture(); panel.actions[0].url = 'javascript:bad()'; panel.blocks[0].text = '<img src=x onerror=bad()> & "text"';
  const parsed = parseWorkbenchPanel(panel);
  assert.equal(parsed.blocks[0].text, panel.blocks[0].text);
  assert.equal(parsed.actions[0].url, undefined);
});

test('spatial pages preserve full tables, chart values, long text and unicode', () => {
  const panel = fixture(); panel.blocks.unshift({ type: 'text', text: 'Long 🧑‍🚀 text '.repeat(80) });
  const pages = generatedPanelPages(parseWorkbenchPanel(panel));
  assert.ok(pages.some(page => page.chart?.series[0].values[1] === 5));
  const text = pages.map(page => page.text).join('\n');
  for (const value of ['Budget', '$400', 'Project: Alpha', 'Hours: 5', 'Estimated hours: 3', 'Beta']) assert.ok(text.includes(value));
  assert.equal(text.includes('\ufffd'), false);
  assert.ok(pages.length > 8);
  assert.match(panelBlockText(panel.blocks[3]), /Project: Beta/);
});

test('the real ECharts renderer accepts generated bars and lines and preserves negative values', () => {
  const chart = init(null, null, { renderer: 'svg', ssr: true, width: 1104, height: 540 });
  try {
    for (const kind of ['bar', 'line']) {
      chart.setOption(generatedChartOption({ type: 'chart', kind, labels: ['Alpha', 'Beta'], series: [{ name: 'Difference', values: [-3, 5] }] }), { notMerge: true });
      const svg = chart.renderToSVGString();
      assert.match(svg, /Difference/); assert.match(svg, /Alpha/); assert.match(svg, /<path/);
      assert.doesNotMatch(svg, /NaN|undefined/);
    }
  } finally { chart.dispose(); }
});

test('the real UIKitML parser accepts the generated panel template and native follow-up buttons', () => {
  const source = readFileSync(new URL('../public/ui/eve-generated.uikitml', import.meta.url), 'utf8');
  assert.doesNotThrow(() => parseUIKitMLSource(source, 'http://localhost/ui/eve-generated.uikitml'));
});
