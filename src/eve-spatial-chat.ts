import { CanvasTexture, LinearFilter, SRGBColorSpace, UIKit } from '@iwsdk/core';
import { eve, type Message } from './eve-client.ts';
import { panelBlockText } from './eve-generated-content.ts';
import type { createGeneratedChartSurface } from './eve-task-chart-surface.js';

/** The same chronological messages and result cards as the browser chat. */
export function mountSpatialChat(viewport: UIKit.Container) {
  const cards = new Map<string, { root: UIKit.Container; text?: UIKit.Text; key: string; dispose: () => void }>();
  let stickToBottom = true;
  let disposed = false;
  const bottom = () => viewport.maxScrollPosition?.peek()[1] || 0;
  const scroll = (amount: number) => {
    if (!viewport.scrollPosition) return;
    viewport.scrollPosition.value = [0, Math.max(0, Math.min(bottom(), viewport.scrollPosition.peek()[1] + amount))];
    stickToBottom = bottom() - viewport.scrollPosition.peek()[1] < 12;
  };
  const scrollEnd = () => { if (stickToBottom && viewport.scrollPosition) viewport.scrollPosition.value = [0, bottom()]; };
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
    if (!message.panel) body = text(root, message.text);
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
    }
    const dispose = () => {
      active = false;
      for (const stop of stopButtons) stop();
      for (const chart of charts) { chart.surface?.dispose(); chart.image.setProperties({ src: undefined }); chart.texture.dispose(); }
      root.removeFromParent();
      for (const node of nodes.reverse()) node.dispose();
    };
    return { root, text: body, key: message.panel ? JSON.stringify(message.panel) : '', dispose };
  };
  const stopState = eve.subscribe(state => {
    if (viewport.scrollPosition) stickToBottom = bottom() - viewport.scrollPosition.peek()[1] < 12;
    viewport.setProperties({ display: state.messages.length ? 'flex' : 'none' });
    const ids = new Set(state.messages.map(message => message.id));
    for (const [id, card] of cards) if (!ids.has(id)) { card.dispose(); cards.delete(id); }
    for (const message of state.messages) {
      let card = cards.get(message.id);
      const changed = message.panel && card?.key !== JSON.stringify(message.panel);
      if (card && changed) { card.dispose(); cards.delete(message.id); card = undefined; }
      if (!card) { card = makeCard(message); cards.set(message.id, card); viewport.add(card.root); }
      else if (card.text) card.text.setProperties({ text: message.text });
    }
    // Stable chronological order, including an updated result card in its original turn.
    const order = state.messages.map(message => cards.get(message.id)!.root);
    if (order.some((root, index) => viewport.children[index] !== root)) {
      viewport.remove(...order); viewport.add(...order);
    }
    scrollEnd();
  });
  const stopSize = viewport.maxScrollPosition?.subscribe(() => { if (!disposed) scrollEnd(); });
  return { scroll, dispose() { disposed = true; stopState(); stopSize?.(); for (const card of cards.values()) card.dispose(); cards.clear(); } };
}
