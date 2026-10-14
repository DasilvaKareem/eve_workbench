import { init, use } from 'echarts/core';
import { BarChart, GraphChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, GraphicComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { CHART_HEIGHT, CHART_WIDTH, taskChartOption, type TaskChartView, type WorkbenchTask } from './eve-task-charts.js';

use([BarChart, GraphChart, GridComponent, TooltipComponent, GraphicComponent, CanvasRenderer]);

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
