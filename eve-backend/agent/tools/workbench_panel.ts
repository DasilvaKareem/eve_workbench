import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parseWorkbenchPanel } from '../../shared/workbench-panels';
import { workbenchPanels } from '../lib/workbench-panels';

const short = (max: number) => z.string().trim().min(1).max(max);
const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: short(4000) }),
  z.object({ type: z.literal('metrics'), items: z.array(z.object({ label: short(80), value: short(120) })).min(1).max(6) }),
  z.object({ type: z.literal('table'), columns: z.array(short(60)).min(1).max(4), rows: z.array(z.array(z.string().max(240)).min(1).max(4)).min(1).max(20) }),
  z.object({ type: z.literal('chart'), kind: z.enum(['bar', 'line']), labels: z.array(short(80)).min(1).max(20),
    series: z.array(z.object({ name: short(80), values: z.array(z.number().min(-1e12).max(1e12)).min(1).max(20) })).min(1).max(3) }),
]);

export default defineTool({
  description: 'Create or update a visible panel in the browser and WebXR workspace. Compose text, metric cards, tables, and bar/line charts. Use a stable panel id to replace it. Actions are follow-up prompts sent only when the user clicks. Never invent measured data. Returns the complete conversation-scoped panel snapshot.',
  inputSchema: z.object({
    operation: z.enum(['upsert', 'remove', 'list']),
    panel: z.object({ id: short(64).regex(/^[a-zA-Z0-9_-]+$/), title: short(120), blocks: z.array(block).min(1).max(8),
      actions: z.array(z.object({ label: short(40), prompt: short(1000) })).max(3).optional() }).optional(),
    panelId: short(64).optional(),
  }),
  execute({ operation, panel: input, panelId }) {
    if (operation === 'upsert') {
      const panel = parseWorkbenchPanel(input);
      if (!panel) throw new Error('Supply a valid panel. Table rows and chart series must match their columns or labels.');
      workbenchPanels.update(panels => [...panels.filter(item => item.id !== panel.id), panel].slice(-6));
    } else if (operation === 'remove') {
      if (!panelId) throw new Error('panelId is required to remove a panel.');
      workbenchPanels.update(panels => panels.filter(panel => panel.id !== panelId));
    }
    return { panels: workbenchPanels.get() };
  },
});
