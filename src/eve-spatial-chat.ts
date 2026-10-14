import { CanvasTexture, LinearFilter, SRGBColorSpace, UIKit } from '@iwsdk/core';
import { eve, type EveState, type Message } from './eve-client.ts';
import { workspaceWindows } from './eve-windows.ts';
import { panelBlockText } from './eve-generated-content.ts';
import type { createGeneratedChartSurface } from './eve-task-chart-surface.js';

/** The same chronological messages and result cards as the browser chat. */
export function mountSpatialChat(viewport: UIKit.Container, select = (state: EveState): Message[] => [
  ...state.messages, ...state.inputs.map(input => ({ id: `input:${input.id}`, role: 'assistant' as const, text: input.title, input })),
], allowOpenWindow = true) {
  const cards = new Map<string, { root: UIKit.Container; text?: UIKit.Text; key: string; dispose: () => void }>();
  let stickToBottom = true;
  let disposed = false;
  let resultAnchor: string | undefined;
  let lastUserId: string | undefined;
  let settingScroll = false;
  const bottom = () => viewport.maxScrollPosition?.peek()[1] || 0;
  const setScroll = (value: number) => {
    if (!viewport.scrollPosition) return;
    settingScroll = true;
    try { viewport.scrollPosition.value = [0, Math.max(0, Math.min(bottom(), value))]; }
    finally { settingScroll = false; }
  };
  const scroll = (amount: number) => {
    if (!viewport.scrollPosition) return;
    resultAnchor = undefined;
    setScroll(viewport.scrollPosition.peek()[1] + amount);
    stickToBottom = bottom() - viewport.scrollPosition.peek()[1] < 12;
  };
  const followLayout = () => {
    if (disposed) return;
    const root = resultAnchor ? cards.get(resultAnchor)?.root : undefined;
    if (root) {
      const center = root.relativeCenter.peek(), size = root.size.peek(), viewportSize = viewport.size.peek();
      if (center && size && viewportSize) setScroll(viewportSize[1] / 2 - center[1] - size[1] / 2);
    } else if (stickToBottom) setScroll(bottom());
  };
  const makeCard = (message: Message) => {
    const nodes: UIKit.Component[] = [];
    const root = new UIKit.Container({ flexDirection: 'column', flexShrink: 0, width: 316, gap: 6,
      padding: 10, borderRadius: 8, backgroundColor: message.role === 'user' ? '#2c3931' : '#1b2b22',
      borderWidth: message.panel ? 1 : 0, borderColor: '#60755d' });
    nodes.push(root);
    const text = (parent: UIKit.Container, value: string, size = 11, color = '#f5f5ee') => {
      const node = new UIKit.Text({ text: value, fontSize: size, color, lineHeight: 1.4, whiteSpace: 'pre-line', flexShrink: 0 });
      nodes.push(node); parent.add(node); return node;
    };
    text(root, message.role === 'user' ? 'YOU' : 'EVE', 8, '#d6f29a');
    let body: UIKit.Text | undefined;
    let active = true;
    const charts: { texture: CanvasTexture; image: UIKit.Image<UIKit.ImageOutProperties<unknown>>; surface?: ReturnType<typeof createGeneratedChartSurface> }[] = [];
    const stopButtons: (() => void)[] = [];
    if (!message.panel) {
      body = text(root, message.text);
      for (const option of message.input?.options || []) {
        const button = text(root, option.label, 11, '#d6f29a');
        button.setProperties({ backgroundColor: '#304137', padding: 8, borderRadius: 6, cursor: 'pointer' });
        const click = () => { if (eve.state.phase === 'waiting') void eve.answer(message.input!.id, option.id); };
        button.addEventListener('click', click); stopButtons.push(() => button.removeEventListener('click', click));
      }
    }
    else {
      const panel = message.panel;
      text(root, panel.title, 14, '#d6f29a');
      for (const block of panel.blocks) {
        if (block.type === 'table') {
          for (const row of [block.columns, ...block.rows]) {
            const group = new UIKit.Container({ flexDirection: 'row', flexShrink: 0, gap: 5 }); nodes.push(group); root.add(group);
            for (const cell of row) {
              const item = text(group, cell, 9, row === block.columns ? '#d6f29a' : '#f5f5ee');
              item.setProperties({ width: (296 - 5 * (row.length - 1)) / row.length });
            }
          }
        } else if (block.type === 'chart') {
          const canvas = document.createElement('canvas'); canvas.width = 1104; canvas.height = 540;
          const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
          texture.generateMipmaps = false; texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
          const image = new UIKit.Image({ src: texture, width: 296, height: 145, flexShrink: 0 }); nodes.push(image); root.add(image);
          const chart: typeof charts[number] = { texture, image }; charts.push(chart);
          void import('./eve-task-chart-surface.js').then(({ createGeneratedChartSurface }) => {
            if (!active) return;
            try { chart.surface = createGeneratedChartSurface(canvas, () => { texture.needsUpdate = true; }); chart.surface.update(block); }
            catch { image.setProperties({ display: 'none' }); }
          }).catch(() => { if (active) image.setProperties({ display: 'none' }); });
          text(root, panelBlockText(block), 8, '#bac9b9');
        } else text(root, panelBlockText(block));
      }
      for (const action of panel.actions) {
        const button = text(root, action.label, 11, '#d6f29a');
        button.setProperties({ backgroundColor: '#304137', padding: 8, borderRadius: 6, cursor: 'pointer' });
        const click = () => { if (['ready', 'waiting'].includes(eve.state.phase)) void eve.send(action.prompt); };
        button.addEventListener('click', click); stopButtons.push(() => button.removeEventListener('click', click));
      }
      if (allowOpenWindow) {
        const button = text(root, 'Open window', 11, '#d6f29a');
        button.setProperties({ backgroundColor: '#304137', padding: 8, borderRadius: 6, cursor: 'pointer' });
        const click = () => workspaceWindows.open(panel.id);
        button.addEventListener('click', click); stopButtons.push(() => button.removeEventListener('click', click));
      }
    }
    const dispose = () => {
      active = false;
      for (const stop of stopButtons) stop();
      for (const chart of charts) { chart.surface?.dispose(); chart.image.setProperties({ src: undefined }); chart.texture.dispose(); }
      root.removeFromParent();
      for (const node of nodes.reverse()) node.dispose();
    };
    stopButtons.push(root.relativeCenter.subscribe(followLayout), root.size.subscribe(followLayout));
    return { root, text: body, key: message.panel || message.input ? JSON.stringify(message.panel || message.input) : '', dispose };
  };
  const stopScroll = viewport.scrollPosition?.subscribe(() => {
    if (!settingScroll) { resultAnchor = undefined; stickToBottom = bottom() - (viewport.scrollPosition?.peek()[1] || 0) < 12; }
  });
  const render = (state: EveState) => {
    const messages = select(state);
    if (viewport.scrollPosition) stickToBottom = bottom() - viewport.scrollPosition.peek()[1] < 12;
    const userId = messages.slice().reverse().find(message => message.role === 'user')?.id;
    if (userId !== lastUserId) { resultAnchor = undefined; stickToBottom = true; lastUserId = userId; }
    viewport.setProperties({ display: messages.length ? 'flex' : 'none' });
    const ids = new Set(messages.map(message => message.id));
    for (const [id, card] of cards) if (!ids.has(id)) { card.dispose(); cards.delete(id); }
    for (const message of messages) {
      let card = cards.get(message.id);
      const changed = (message.panel || message.input) && card?.key !== JSON.stringify(message.panel || message.input);
      if (changed) resultAnchor = message.id;
      if (card && changed) { card.dispose(); cards.delete(message.id); card = undefined; }
      if (!card) { card = makeCard(message); cards.set(message.id, card); viewport.add(card.root); }
      else if (card.text) card.text.setProperties({ text: message.text });
    }
    // Stable chronological order, including an updated result card in its original turn.
    const order = messages.map(message => cards.get(message.id)!.root);
    if (order.some((root, index) => viewport.children[index] !== root)) {
      viewport.remove(...order); viewport.add(...order);
    }
    followLayout();
  };
  const stopState = eve.subscribe(render);
  const stopSize = viewport.maxScrollPosition.subscribe(followLayout);
  const stopViewport = viewport.size.subscribe(followLayout);
  return { scroll, refresh() { render(eve.state); }, dispose() { disposed = true; stopState(); stopSize(); stopViewport(); stopScroll?.(); for (const card of cards.values()) card.dispose(); cards.clear(); } };
}
