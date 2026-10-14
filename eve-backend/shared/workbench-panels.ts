export type PanelBlock =
  | { type: 'text'; text: string }
  | { type: 'metrics'; items: { label: string; value: string }[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'chart'; kind: 'bar' | 'line'; labels: string[]; series: { name: string; values: number[] }[] };
export interface WorkbenchPanel {
  id: string;
  title: string;
  blocks: PanelBlock[];
  actions: { label: string; prompt: string }[];
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const list = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length > 0 && value.length <= max;

/** The wire format is data only. Copy known fields so model output never becomes code or markup. */
export function parseWorkbenchPanel(value: unknown): WorkbenchPanel | null {
  if (!record(value) || !text(value.id, 64) || !/^[a-zA-Z0-9_-]+$/.test(value.id) || !text(value.title, 120) || !list(value.blocks, 8)) return null;
  const blocks: PanelBlock[] = [];
  for (const block of value.blocks) {
    if (!record(block)) return null;
    switch (block.type) {
      case 'text':
        if (!text(block.text, 4000)) return null;
        blocks.push({ type: 'text', text: block.text }); break;
      case 'metrics': {
        if (!list(block.items, 6)) return null;
        const items: { label: string; value: string }[] = [];
        for (const item of block.items) {
          if (!record(item) || !text(item.label, 80) || !text(item.value, 120)) return null;
          items.push({ label: item.label, value: item.value });
        }
        blocks.push({ type: 'metrics', items }); break;
      }
      case 'table': {
        if (!list(block.columns, 4) || !block.columns.every(item => text(item, 60)) || !list(block.rows, 20)) return null;
        const columns = block.columns as string[];
        const rows: string[][] = [];
        for (const row of block.rows) {
          if (!Array.isArray(row) || row.length !== columns.length || !row.every(item => typeof item === 'string' && item.length <= 240)) return null;
          rows.push([...row]);
        }
        blocks.push({ type: 'table', columns: [...columns], rows }); break;
      }
      case 'chart': {
        if (!['bar', 'line'].includes(String(block.kind)) || !list(block.labels, 20) || !block.labels.every(item => text(item, 80)) || !list(block.series, 3)) return null;
        const labels = block.labels as string[];
        const series: { name: string; values: number[] }[] = [];
        for (const entry of block.series) {
          if (!record(entry) || !text(entry.name, 80) || !Array.isArray(entry.values) || entry.values.length !== labels.length || !entry.values.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1e12)) return null;
          series.push({ name: entry.name, values: [...entry.values] });
        }
        blocks.push({ type: 'chart', kind: block.kind as 'bar' | 'line', labels: [...labels], series }); break;
      }
      default: return null;
    }
  }
  if (value.actions !== undefined && (!Array.isArray(value.actions) || value.actions.length > 3)) return null;
  const actions: WorkbenchPanel['actions'] = [];
  for (const action of (value.actions || []) as unknown[]) {
    if (!record(action) || !text(action.label, 40) || !text(action.prompt, 1000)) return null;
    actions.push({ label: action.label, prompt: action.prompt });
  }
  return { id: value.id, title: value.title, blocks, actions };
}

/** Reject an entire malformed snapshot; preserve the last known good panels. */
export function parseWorkbenchPanels(value: unknown): WorkbenchPanel[] | null {
  if (!Array.isArray(value) || value.length > 6) return null;
  const panels = value.map(parseWorkbenchPanel);
  if (panels.some(panel => !panel) || new Set(panels.map(panel => panel!.id)).size !== panels.length) return null;
  return panels as WorkbenchPanel[];
}
