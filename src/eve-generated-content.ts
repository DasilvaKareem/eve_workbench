import type { EChartsOption } from 'echarts';
import type { PanelBlock, WorkbenchPanel } from '../shared/workbench-panels.js';
import { paginatePanelText } from './eve-panel-content.ts';

export type ChartBlock = Extract<PanelBlock, { type: 'chart' }>;
export interface GeneratedPage { text: string; chart?: ChartBlock }

export function panelBlockText(block: PanelBlock): string {
  switch (block.type) {
    case 'text': return block.text;
    case 'metrics': return block.items.map(item => `${item.label}\n${item.value}`).join('\n\n');
    case 'table': return block.rows.map((row, index) => `${index + 1}. ${row.map((cell, column) => `${block.columns[column]}: ${cell}`).join('\n')}`).join('\n\n');
    case 'chart': return block.labels.map((label, index) => `${label}\n${block.series.map(series => `${series.name}: ${series.values[index]}`).join('\n')}`).join('\n\n');
  }
}

/** Native UIKit text pages preserve every value; chart pages have separate data pages. */
export function generatedPanelPages(panel: WorkbenchPanel): GeneratedPage[] {
  const pages: GeneratedPage[] = paginatePanelText(panel.title).map(text => ({ text }));
  for (const block of panel.blocks) {
    if (block.type === 'chart') pages.push({ text: 'Next page: complete chart data.', chart: block });
    for (const text of paginatePanelText(panelBlockText(block))) pages.push({ text });
  }
  return pages;
}

export function generatedChartOption(block: ChartBlock): EChartsOption {
  return {
    animation: false, backgroundColor: '#151d21', color: ['#d6f29a', '#e8bc78', '#8fa5c9'],
    textStyle: { fontFamily: 'sans-serif', color: '#f3f3ee', fontSize: 24 },
    grid: { left: 120, right: 45, top: 65, bottom: 115, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' },
    legend: { top: 10, textStyle: { color: '#f3f3ee', fontSize: 24 }, type: 'scroll' },
    tooltip: { trigger: 'axis', renderMode: 'richText', textStyle: { fontSize: 24 } },
    xAxis: { type: 'category', data: block.labels, axisLabel: { color: '#b6c7bd', fontSize: 23, width: 130, overflow: 'truncate', rotate: 25 } },
    yAxis: { type: 'value', axisLabel: { color: '#b6c7bd', fontSize: 23 }, splitLine: { lineStyle: { color: '#314139' } } },
    series: block.series.map(series => ({ type: block.kind, name: series.name, data: series.values, ...(block.kind === 'bar' ? { barMaxWidth: 64 } : { symbolSize: 10 }) })),
  };
}
