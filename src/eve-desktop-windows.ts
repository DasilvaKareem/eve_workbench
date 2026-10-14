import { mountInlinePanel } from './eve-generated-panels.ts';
import { workspaceWindows } from './eve-windows.ts';

export function mountDesktopWindows() {
  const layer = document.createElement('div'); layer.className = 'eve-window-layer'; document.body.append(layer);
  const views = new Map<string, { root: HTMLElement; title: HTMLElement; content: HTMLElement; key: string; dispose: () => void }>();
  let front = 1;
  const stop = workspaceWindows.subscribe(() => {
    const ids = new Set(workspaceWindows.entries.map(entry => entry.id));
    for (const [id, view] of views) if (!ids.has(id)) { view.dispose(); view.root.remove(); views.delete(id); }
    for (const entry of workspaceWindows.entries) {
      let view = views.get(entry.id);
      if (!view) {
        const root = document.createElement('section'); root.className = 'eve-floating-window'; root.setAttribute('role', 'dialog');
        root.style.left = `${24 + views.size * 32}px`; root.style.top = `${90 + views.size * 26}px`;
        const header = document.createElement('header'), title = document.createElement('span'), close = document.createElement('button'), content = document.createElement('div');
        header.className = 'eve-window-title'; close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close window');
        content.className = 'eve-window-body'; header.append(title, close); root.append(header, content); layer.append(root);
        close.addEventListener('click', () => workspaceWindows.close(entry.id));
        root.addEventListener('pointerdown', () => { root.style.zIndex = String(++front); });
        let drag: { x: number; y: number; left: number; top: number } | undefined;
        header.addEventListener('pointerdown', event => {
          if (event.target === close) return;
          const box = root.getBoundingClientRect(); drag = { x: event.clientX, y: event.clientY, left: box.left, top: box.top }; header.setPointerCapture(event.pointerId);
        });
        header.addEventListener('pointermove', event => {
          if (!drag) return;
          root.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, drag.left + event.clientX - drag.x))}px`;
          root.style.top = `${Math.max(0, Math.min(window.innerHeight - 50, drag.top + event.clientY - drag.y))}px`;
        });
        const end = () => { drag = undefined; }; header.addEventListener('pointerup', end); header.addEventListener('pointercancel', end);
        view = { root, title, content, key: '', dispose: () => {} }; views.set(entry.id, view);
      }
      view.title.textContent = entry.panel?.title || 'New window'; view.root.setAttribute('aria-label', view.title.textContent);
      const key = JSON.stringify(entry.panel || null);
      if (view.key !== key) {
        view.dispose(); view.content.replaceChildren(); view.key = key;
        if (entry.panel) view.dispose = mountInlinePanel(view.content, entry.panel, undefined, false);
        else { view.content.textContent = 'Ask Eve in Talk or type what to put in this window — a graph, tasks, notes, or a table.'; view.dispose = () => {}; }
      }
    }
  });
  return () => { stop(); for (const view of views.values()) view.dispose(); layer.remove(); };
}
