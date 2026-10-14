import { eve } from './eve-client.js';
import { browserWatch } from './eve-browser-watch.js';
import { createBrowserSurface } from './eve-browser-surface.js';
import { VisibilityState, type World } from '@iwsdk/core';

export function mountBrowserPanel(board: HTMLDetailsElement, world: World) {
  const host = document.createElement('div');
  host.className = 'eve-browser-panel';
  host.innerHTML = `<p class="eve-browser-status" role="status"></p><p class="eve-browser-url"></p>
    <canvas aria-label="Eve's sandbox browser, watch only" role="img"></canvas>
    <p class="eve-browser-frame-time"></p><ol class="eve-browser-actions" aria-label="Browser activity"></ol>
    <p class="eve-browser-caption">Watch only · Screen refreshes about once a second. Ask Eve to navigate and interact.</p>`;
  board.append(host);
  const canvas = host.querySelector('canvas')!;
  const surface = createBrowserSurface(canvas);
  let immersive = world.visibilityState.peek() !== VisibilityState.NonImmersive;
  const onToggle = () => browserWatch.setActive('desktop', board.open && !document.hidden && !immersive);
  const stopVisibility = world.visibilityState.subscribe(value => { immersive = value !== VisibilityState.NonImmersive; onToggle(); });
  board.addEventListener('toggle', onToggle);
  document.addEventListener('visibilitychange', onToggle);
  const stopWatch = browserWatch.subscribe(state => {
    host.querySelector('.eve-browser-status')!.textContent = state.message;
    host.querySelector('.eve-browser-url')!.textContent = state.url || 'No page opened yet';
    host.querySelector('.eve-browser-frame-time')!.textContent = state.frame ? `Last frame received ${new Date(state.frame.receivedAt).toLocaleTimeString()}` : '';
    canvas.hidden = !state.frame;
    surface.update(state.frame);
  });
  let lastActions = '';
  const stopEve = eve.subscribe(state => {
    const key = JSON.stringify(state.browserActions);
    if (key === lastActions) return;
    lastActions = key;
    const list = host.querySelector('ol')!; list.replaceChildren();
    for (const action of state.browserActions.slice(-6)) {
      const item = document.createElement('li'); item.textContent = `${action.tool} · ${action.status}`; list.append(item);
    }
  });
  onToggle();
  return () => {
    stopWatch(); stopEve(); stopVisibility(); browserWatch.setActive('desktop', false); surface.dispose();
    board.removeEventListener('toggle', onToggle); document.removeEventListener('visibilitychange', onToggle); host.remove();
  };
}
