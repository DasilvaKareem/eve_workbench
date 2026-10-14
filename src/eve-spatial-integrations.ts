import { UIKit } from '@iwsdk/core';
import { integrations, type IntegrationsState } from './eve-integrations.ts';

/** Native ray/poke controls use the same connection state as the desktop panel. */
export function mountSpatialIntegrations(viewport: UIKit.Container, authorize = (url: string) => { window.location.assign(url); }) {
  let key = '', previousMode = '', nodes: UIKit.Component[] = [], stops: (() => void)[] = [];
  const clear = () => { for (const stop of stops) stop(); stops = []; for (const node of nodes.reverse()) { node.removeFromParent(); node.dispose(); } nodes = []; };
  const scroll = (amount: number) => { if (viewport.scrollPosition) viewport.scrollPosition.value = [0, Math.max(0,
    Math.min(viewport.maxScrollPosition.peek()[1] || 0, viewport.scrollPosition.peek()[1] + amount))]; };
  const render = (state: IntegrationsState) => {
    const nextKey = JSON.stringify(state); if (nextKey === key) return; key = nextKey;
    clear(); viewport.setProperties({ display: 'flex' });
    const root = new UIKit.Container({ width: 316, flexDirection: 'column', gap: 8, flexShrink: 0 }); nodes.push(root); viewport.add(root);
    const text = (parent: UIKit.Container, value: string, size = 11, color = '#f5f5ee') => {
      const node = new UIKit.Text({ text: value, fontSize: size, color, whiteSpace: 'pre-line', lineHeight: 1.4, flexShrink: 0 }); nodes.push(node); parent.add(node); return node;
    };
    const button = (parent: UIKit.Container, label: string, action: () => void, disabled = false) => {
      const node = text(parent, label, 11, disabled ? '#829582' : '#d6f29a');
      node.setProperties({ padding: 8, borderRadius: 6, backgroundColor: '#304137', cursor: 'pointer' });
      const click = () => { if (!disabled) action(); }; node.addEventListener('click', click); stops.push(() => node.removeEventListener('click', click));
    };
    text(root, 'Connect your apps so Eve can work with them. Connections are shared within this workspace.', 10, '#bac9b9');
    button(root, state.mode === 'catalog' ? 'Your integrations' : '+ Add integration', () => integrations.showCatalog(state.mode !== 'catalog'));
    button(root, state.loading ? 'Checking connections…' : 'Refresh connections', () => { void integrations.refresh(); }, state.loading || Boolean(state.busy));
    if (state.error) text(root, state.error, 10, '#f3d6aa');
    if (state.authorization) {
      const auth = state.authorization;
      text(root, `Continue in your browser to connect ${auth.name}. This leaves XR; return here after sign-in.${auth.userCode ? `\nCode: ${auth.userCode}` : ''}`, 10);
      button(root, `Continue sign-in to ${auth.name}`, () => authorize(auth.url));
    }
    const apps = state.apps.filter(app => state.mode === 'catalog' || app.status === 'connected');
    if (!apps.length && !state.loading && !state.error) text(root, 'No apps connected yet. Choose Add integration to get started.');
    for (const app of apps) {
      const card = new UIKit.Container({ flexDirection: 'column', gap: 5, padding: 10, borderWidth: 1, borderColor: '#60755d', borderRadius: 8, flexShrink: 0 }); nodes.push(card); root.add(card);
      text(card, app.name, 14, '#d6f29a'); text(card, app.description, 10);
      text(card, app.status === 'connected' ? 'Connected' : app.status === 'unavailable' ? 'Status unavailable' : 'Not connected', 9, '#bac9b9');
      button(card, state.busy === app.id ? 'Working…' : app.status === 'connected' ? 'Disconnect' : 'Connect',
        () => { if (app.status === 'connected') void integrations.disconnect(app.id); else void integrations.connect(app.id); }, Boolean(state.busy));
    }
    if (state.mode !== previousMode && viewport.scrollPosition) viewport.scrollPosition.value = [0, 0]; previousMode = state.mode;
  };
  const stopState = integrations.subscribe(render);
  const onFocus = () => { void integrations.refresh(); };
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
  return { scroll, refresh() { render(integrations.state); }, dispose() { stopState(); clear(); if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus); } };
}
