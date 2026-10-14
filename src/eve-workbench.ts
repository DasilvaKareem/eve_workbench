import type { World } from '@iwsdk/core';
import { VisibilityState } from '@iwsdk/core';
import { eve, type EveState } from './eve-client.js';
import { mountTaskDashboard } from './eve-task-dashboard.js';
import { mountBrowserPanel } from './eve-browser-panel.js';
import './eve-workbench.css';

const icons = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  headset: '<path d="M4 8h16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4l-2-3h-4l-2 3H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="M7 12v2m10-2v2M6 8l2-4h8l2 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
};
const icon = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

export function mountWorkbench(world: World) {
  const shell = document.createElement('div');
  shell.className = 'eve-shell';
  shell.innerHTML = `
    <header class="eve-topbar">
      <a class="eve-brand" href="/" aria-label="Eve Workbench home"><span class="eve-mark">e</span><span>eve <span class="eve-divider">/</span> <strong>workbench</strong></span></a>
      <div class="eve-top-actions"><span class="eve-mode">SPATIAL WORKSPACE <span>01</span></span><button class="eve-xr" type="button">${icon('headset')} Enter XR</button></div>
    </header>
    <section class="eve-intro" aria-label="Workspace introduction"><div class="eve-eyebrow"><span></span> A SPACE FOR YOUR IDEAS</div><h1>A little more room<br>to think.</h1><p>Your agent. Your work. A new perspective.</p><div class="eve-scene-label"><span class="eve-cross">+</span> Explore the room · Point to interact</div></section>
    <section class="eve-console" aria-label="Eve assistant">
      <header class="eve-console-header"><div class="eve-agent-icon">e</div><div><h2>Eve</h2><p class="eve-status" role="status">Connecting</p></div><button class="eve-icon-button eve-new" title="New conversation" aria-label="New conversation" type="button">${icon('plus')}</button><button class="eve-icon-button eve-collapse" title="Minimize chat" aria-label="Minimize chat" aria-expanded="true" type="button">−</button></header>
      <div class="eve-console-content">
        <div class="eve-messages" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"></div>
        <div class="eve-notice" role="status" hidden></div>
        <form class="eve-unlock" hidden><label for="eve-access">Unlock your private workspace</label><div><input id="eve-access" type="password" autocomplete="current-password" placeholder="Workspace access code" required><button type="submit">Unlock</button></div></form>
        <div class="eve-inputs"></div>
        <details class="eve-task-board"><summary>Task board</summary><ul></ul></details>
        <details class="eve-browser-board"><summary>Watch Eve’s browser</summary></details>
        <div class="eve-suggestions"><button type="button" data-prompt="Help me plan my next project. Ask me what I want to build.">Plan a project ${icon('arrow')}</button><button type="button" data-prompt="Show my task board and suggest what I should focus on next.">Find my focus ${icon('arrow')}</button></div>
        <form class="eve-composer"><label class="eve-sr-only" for="eve-message">Message Eve</label><textarea id="eve-message" rows="2" maxlength="12000" placeholder="What are we working on?" required></textarea><div class="eve-composer-footer"><span>Connected to your Eve agent</span><button class="eve-mic eve-icon-button" type="button" title="Dictate a message" aria-label="Dictate a message" hidden>${icon('mic')}</button><button class="eve-send" type="submit" title="Send message" aria-label="Send message">${icon('arrow')}</button><button class="eve-stop eve-icon-button" type="button" title="Cancel task" aria-label="Cancel task" hidden>${icon('stop')}</button></div></form>
        <div class="eve-console-footer"><span class="eve-connection-dot"></span><span class="eve-session">DURABLE CONVERSATION</span><button class="eve-retry" type="button" hidden>Retry connection</button></div>
      </div>
    </section>
    <footer class="eve-bottom"><span>BUILT FOR A DIFFERENT POINT OF VIEW</span><span>WEBXR <b>×</b> EVE</span></footer>`;
  document.body.append(shell);
  const find = <T extends HTMLElement>(selector: string) => shell.querySelector<T>(selector)!;
  const messages = find<HTMLDivElement>('.eve-messages');
  const composer = find<HTMLFormElement>('.eve-composer');
  const textarea = find<HTMLTextAreaElement>('#eve-message');
  const unlock = find<HTMLFormElement>('.eve-unlock');
  const notice = find<HTMLDivElement>('.eve-notice');
  const transcript = new Map<string, HTMLElement>();
  const launch = find<HTMLButtonElement>('.eve-xr');
  let lastError: string | null = null;
  let lastInputs = '';
  let lastTasks = '';

  const render = (state: EveState) => {
    const available = ['ready', 'waiting'].includes(state.phase);
    find('.eve-status').textContent = state.activity;
    shell.dataset.phase = state.phase;
    textarea.disabled = !available;
    find<HTMLButtonElement>('.eve-send').disabled = !available || !textarea.value.trim();
    find('.eve-send').hidden = state.phase === 'working';
    find('.eve-stop').hidden = !['working', 'waiting'].includes(state.phase);
    find<HTMLButtonElement>('.eve-new').disabled = ['working', 'connecting', 'locked', 'setup'].includes(state.phase);
    unlock.hidden = state.phase !== 'locked';
    composer.hidden = ['locked', 'setup'].includes(state.phase);
    find('.eve-suggestions').hidden = !available || state.messages.length > 0;
    find('.eve-retry').hidden = !['error', 'setup'].includes(state.phase);
    find('.eve-session').textContent = state.sessionId ? `SESSION · ${state.sessionId.slice(-8).toUpperCase()}` : 'DURABLE CONVERSATION';
    const text = state.error || (state.phase === 'setup' ? 'Start the Eve backend and configure your connection. See docs/eve-integration.md in this project.' : '');
    if (text !== lastError) { notice.textContent = text; lastError = text; }
    notice.hidden = !text;
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    for (const [id, element] of transcript) {
      if (!state.messages.some(message => message.id === id)) { element.remove(); transcript.delete(id); }
    }
    messages.querySelector('.eve-empty')?.remove();
    if (!state.messages.length) {
      const empty = document.createElement('div'); empty.className = 'eve-empty';
      const heading = document.createElement('h3'); heading.textContent = 'Make yourself at home.';
      const copy = document.createElement('p'); copy.textContent = 'Bring an idea, make a plan, or pick up where you left off. Eve keeps the conversation with you.';
      empty.append(heading, copy); messages.append(empty);
    }
    for (const message of state.messages) {
      let item = transcript.get(message.id);
      if (!item) {
        item = document.createElement('article'); item.className = `eve-message eve-message-${message.role}`;
        const label = document.createElement('span'); label.className = 'eve-message-author'; label.textContent = message.role === 'user' ? 'YOU' : 'EVE';
        const content = document.createElement('div'); item.append(label, content); transcript.set(message.id, item); messages.append(item);
      }
      const content = item.lastElementChild!;
      if (content.textContent !== message.text) content.textContent = message.text;
    }
    if (nearBottom) messages.scrollTop = messages.scrollHeight;
    const inputKey = JSON.stringify(state.inputs);
    const taskKey = JSON.stringify(state.tasks);
    if (taskKey !== lastTasks) {
      lastTasks = taskKey;
      const board = find<HTMLDetailsElement>('.eve-task-board');
      board.querySelector('summary')!.textContent = state.tasks.length ? `Task board · ${state.tasks.filter(task => task.status === 'done').length}/${state.tasks.length} complete` : 'Task board · No tasks yet';
      const list = board.querySelector('ul')!; list.replaceChildren();
      for (const task of state.tasks) {
        const item = document.createElement('li');
        const title = document.createElement('span'); title.textContent = task.title;
        const status = document.createElement('small'); status.textContent = task.status.replace('_', ' ');
        item.dataset.status = task.status; item.append(title, status); list.append(item);
      }
    }
    if (inputKey !== lastInputs) {
      lastInputs = inputKey;
      const target = find('.eve-inputs'); target.replaceChildren();
      for (const input of state.inputs) {
        const heading = document.createElement('p'); heading.textContent = input.title; target.append(heading);
        for (const option of input.options) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = option.label;
          button.addEventListener('click', () => { button.disabled = true; void eve.answer(input.id, option.id); }); target.append(button);
        }
      }
    }
  };
  const unsubscribe = eve.subscribe(render);
  const stopDashboard = mountTaskDashboard(find<HTMLDetailsElement>('.eve-task-board'));
  const stopBrowser = mountBrowserPanel(find<HTMLDetailsElement>('.eve-browser-board'), world);
  textarea.addEventListener('input', () => { find<HTMLButtonElement>('.eve-send').disabled = !textarea.value.trim() || !['ready', 'waiting'].includes(eve.state.phase); });
  composer.addEventListener('submit', event => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text || !['ready', 'waiting'].includes(eve.state.phase)) return;
    textarea.value = ''; void eve.send(text);
  });
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer.requestSubmit(); }
  });
  // Keep desktop typing from also driving the SDK's keyboard locomotion.
  for (const eventName of ['keydown', 'keyup']) shell.addEventListener(eventName, event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) event.stopPropagation();
  });
  unlock.addEventListener('submit', event => {
    event.preventDefault(); const input = find<HTMLInputElement>('#eve-access');
    const value = input.value; input.value = ''; void eve.unlock(value);
  });
  find('.eve-new').addEventListener('click', () => void eve.newConversation());
  find('.eve-stop').addEventListener('click', () => void eve.cancel());
  find('.eve-retry').addEventListener('click', () => void eve.connect());
  for (const button of shell.querySelectorAll<HTMLButtonElement>('[data-prompt]')) button.addEventListener('click', () => void eve.send(button.dataset.prompt!));
  find('.eve-collapse').addEventListener('click', () => {
    const collapsed = find('.eve-console').classList.toggle('is-collapsed');
    find('.eve-collapse').setAttribute('aria-expanded', String(!collapsed));
    find('.eve-collapse').setAttribute('aria-label', collapsed ? 'Expand chat' : 'Minimize chat');
    find('.eve-collapse').textContent = collapsed ? '+' : '−';
  });
  launch.addEventListener('click', () => {
    void Promise.resolve(world.launchXR()).catch(() => {
      notice.hidden = false; notice.textContent = 'Use a WebXR-compatible headset browser over HTTPS, or the local XR emulator.';
    });
  });
  const stopVisibility = world.visibilityState.subscribe(value => {
    document.body.classList.toggle('eve-immersive', value !== VisibilityState.NonImmersive);
  });
  if (!world.xrEnabled) { launch.disabled = true; launch.title = 'This browser does not currently offer an immersive XR session.'; }
  void eve.connect();
  return () => { unsubscribe(); stopDashboard(); stopBrowser(); stopVisibility(); shell.remove(); };
}
