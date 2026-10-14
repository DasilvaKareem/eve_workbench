import { integrations } from './eve-integrations.ts';

export function mountIntegrationsPanel(content: HTMLElement) {
  content.classList.add('eve-integrations');
  const intro = document.createElement('p'); intro.textContent = 'Connect your apps so Eve can work with them. Connections are shared within this workspace.';
  const controls = document.createElement('div'); controls.className = 'eve-panel-actions';
  const add = document.createElement('button'), back = document.createElement('button'), refresh = document.createElement('button');
  for (const button of [add, back, refresh]) button.type = 'button';
  add.textContent = 'Add integration'; back.textContent = 'Your integrations'; refresh.textContent = 'Refresh'; controls.append(add, back, refresh);
  add.addEventListener('click', () => integrations.showCatalog()); back.addEventListener('click', () => integrations.showCatalog(false)); refresh.addEventListener('click', () => { void integrations.refresh(); });
  const notice = document.createElement('p'); notice.setAttribute('role', 'status');
  const authorization = document.createElement('div'); authorization.className = 'eve-integration-authorization';
  const list = document.createElement('div'); list.className = 'eve-integration-list'; content.append(intro, controls, notice, authorization, list);
  const stop = integrations.subscribe(state => {
    add.hidden = state.mode === 'catalog'; back.hidden = state.mode !== 'catalog'; refresh.disabled = state.loading || Boolean(state.busy);
    notice.textContent = state.error || (state.loading ? 'Checking connections…' : ''); notice.hidden = !notice.textContent;
    authorization.replaceChildren();
    if (state.authorization) {
      const text = document.createElement('p'); text.textContent = `Finish connecting ${state.authorization.name} in your browser.${state.authorization.userCode ? ` Code: ${state.authorization.userCode}` : ''}`;
      const link = document.createElement('a'); link.textContent = `Continue sign-in to ${state.authorization.name}`; link.href = state.authorization.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; authorization.append(text, link);
    }
    list.replaceChildren();
    const apps = state.apps.filter(app => state.mode === 'catalog' || app.status === 'connected');
    if (!apps.length && !state.loading && !state.error) { const empty = document.createElement('p'); empty.textContent = 'No apps connected yet. Choose Add integration to get started.'; list.append(empty); }
    for (const app of apps) {
      const card = document.createElement('div'); card.className = 'eve-integration-app';
      const name = document.createElement('h3'), description = document.createElement('p'), status = document.createElement('span'), button = document.createElement('button');
      name.textContent = app.name; description.textContent = app.description;
      status.textContent = app.status === 'connected' ? 'Connected' : app.status === 'unavailable' ? 'Status unavailable' : 'Not connected';
      status.className = `eve-integration-status ${app.status}`;
      button.type = 'button'; button.textContent = state.busy === app.id ? 'Working…' : app.status === 'connected' ? 'Disconnect' : 'Connect'; button.disabled = Boolean(state.busy);
      button.addEventListener('click', () => { if (app.status === 'connected') void integrations.disconnect(app.id); else void integrations.connect(app.id); });
      card.append(name, description, status, button); list.append(card);
    }
  });
  const onFocus = () => { void integrations.refresh(); };
  window.addEventListener('focus', onFocus);
  return () => { stop(); window.removeEventListener('focus', onFocus); content.classList.remove('eve-integrations'); };
}
