import { init, use } from 'echarts/core';
import { BarChart, GraphChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, GraphicComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { CHART_HEIGHT, CHART_WIDTH, taskChartOption, type TaskChartView, type WorkbenchTask } from './eve-task-charts.js';
import { generatedChartOption, type ChartBlock } from './eve-generated-content.js';

use([BarChart, GraphChart, LineChart, GridComponent, TooltipComponent, GraphicComponent, LegendComponent, CanvasRenderer]);

export function createGeneratedChartSurface(canvas: HTMLCanvasElement, onRendered?: () => void) {
  const chart = init(canvas, undefined, { renderer: 'canvas', devicePixelRatio: 1, width: CHART_WIDTH, height: CHART_HEIGHT });
  if (onRendered) chart.on('rendered', onRendered);
  let key = '';
  return {
    update(block: ChartBlock) {
      const next = JSON.stringify(block);
      if (next === key) return;
      chart.setOption(generatedChartOption(block), { notMerge: true, lazyUpdate: false });
      key = next; onRendered?.();
    },
    dispose() { chart.dispose(); },
  };
}

/** One bounded canvas per surface; redraw only when the task data/view changes. */
export function createTaskChartSurface(canvas: HTMLCanvasElement, onRendered?: () => void) {
  const chart = init(canvas, undefined, { renderer: 'canvas', devicePixelRatio: 1, width: CHART_WIDTH, height: CHART_HEIGHT });
  if (onRendered) chart.on('rendered', onRendered);
  let key = '';
  return {
    update(tasks: readonly WorkbenchTask[], view: TaskChartView, page = 0) {
      const next = JSON.stringify([tasks, view, page]);
      if (next === key) return;
      chart.setOption(taskChartOption(tasks, view, page), { notMerge: true, lazyUpdate: false });
      key = next;
      onRendered?.();
    },
    dispose() { chart.dispose(); },
  };
}

export type TaskChartSurface = ReturnType<typeof createTaskChartSurface>;
