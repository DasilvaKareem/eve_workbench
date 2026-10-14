import type { World } from '@iwsdk/core';
import { VisibilityState } from '@iwsdk/core';
import { eve, type EveState } from './eve-client.js';
import { eveVoice } from './eve-voice.js';
import { promptDraft } from './eve-prompt.js';
import { mountInlinePanel } from './eve-generated-panels.js';
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
      <a class="eve-brand" href="/">eve</a>
      <button class="eve-xr" type="button">${icon('headset')} Enter XR</button>
    </header>
    <section class="eve-console" aria-label="Eve">
      <div class="eve-messages" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"></div>
      <div class="eve-notice" role="status" hidden></div>
      <form class="eve-unlock" hidden><label for="eve-access">Unlock your workspace</label><div><input id="eve-access" type="password" autocomplete="current-password" placeholder="Access code" required><button type="submit">Unlock</button></div></form>
      <div class="eve-inputs"></div>
      <form class="eve-composer">
        <label class="eve-sr-only" for="eve-message">Talk or type</label>
        <textarea id="eve-message" rows="2" maxlength="12000" placeholder="Talk or type" required></textarea>
        <div class="eve-composer-footer"><span class="eve-status" role="status">Connecting…</span>
          <button class="eve-mic eve-icon-button" type="button" title="Talk" aria-label="Open keyboard for typing or native dictation">${icon('mic')}</button>
          <button class="eve-send" type="submit" title="Send" aria-label="Send">${icon('arrow')}</button>
          <button class="eve-stop eve-icon-button" type="button" title="Stop Eve" aria-label="Stop Eve" hidden>${icon('stop')}</button>
        </div>
      </form>
      <button class="eve-retry" type="button" hidden>Reconnect</button>
    </section>`;
  document.body.append(shell);
  const find = <T extends HTMLElement>(selector: string) => shell.querySelector<T>(selector)!;
  const messages = find<HTMLDivElement>('.eve-messages');
  const composer = find<HTMLFormElement>('.eve-composer');
  const textarea = find<HTMLTextAreaElement>('#eve-message');
  const unlock = find<HTMLFormElement>('.eve-unlock');
  const notice = find<HTMLDivElement>('.eve-notice');
  const transcript = new Map<string, HTMLElement>();
  const panelCards = new Map<string, { key: string; dispose: () => void }>();
  const launch = find<HTMLButtonElement>('.eve-xr');
  let lastError: string | null = null;
  let lastInputs = '';
  let resultAnchor: HTMLElement | undefined;
  let lastUserId: string | undefined;
  const revealResult = () => {
    if (resultAnchor?.isConnected) messages.scrollTop += resultAnchor.getBoundingClientRect().top - messages.getBoundingClientRect().top;
  };
  // A result stays visible while Eve writes its follow-up; manual scrolling takes over.
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) messages.addEventListener(event, () => { resultAnchor = undefined; });


  const render = (state: EveState) => {
    const available = ['ready', 'waiting'].includes(state.phase);
    find('.eve-status').textContent = state.activity;
    shell.dataset.phase = state.phase;
    textarea.disabled = !available;
    find<HTMLButtonElement>('.eve-send').disabled = !available || !textarea.value.trim();
    find('.eve-send').hidden = state.phase === 'working';
    find('.eve-stop').hidden = !['working', 'waiting'].includes(state.phase);

    unlock.hidden = state.phase !== 'locked';
    composer.hidden = ['locked', 'setup'].includes(state.phase);

    find('.eve-retry').hidden = !['error', 'setup'].includes(state.phase);

    const text = state.error || (state.phase === 'setup' ? 'Start the Eve backend and configure your connection. See docs/eve-integration.md in this project.' : '');
    if (text !== lastError) { notice.textContent = text; lastError = text; }
    notice.hidden = !text;
    let nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    const userId = state.messages.slice().reverse().find(message => message.role === 'user')?.id;
    if (userId !== lastUserId) { resultAnchor = undefined; nearBottom = true; lastUserId = userId; }
    for (const [id, element] of transcript) {
      if (!state.messages.some(message => message.id === id)) { panelCards.get(id)?.dispose(); panelCards.delete(id); element.remove(); transcript.delete(id); }
    }
    messages.querySelector('.eve-empty')?.remove();
    for (const message of state.messages) {
      let item = transcript.get(message.id);
      if (!item) {
        item = document.createElement('article'); item.className = `eve-message eve-message-${message.role}`;
        const label = document.createElement('span'); label.className = 'eve-message-author'; label.textContent = message.role === 'user' ? 'YOU' : 'EVE';
        const content = document.createElement('div'); item.append(label, content); transcript.set(message.id, item); messages.append(item);
      }
      const content = item.lastElementChild!;
      if (message.panel) {
        const key = JSON.stringify(message.panel);
        if (panelCards.get(message.id)?.key !== key) {
          resultAnchor = item;
          panelCards.get(message.id)?.dispose(); content.replaceChildren();
          const dispose = mountInlinePanel(content as HTMLElement, message.panel, () => { if (resultAnchor === item) revealResult(); });
          panelCards.set(message.id, { key, dispose });
        }
      } else if (content.textContent !== message.text) content.textContent = message.text;
    }
    if (resultAnchor) revealResult();
    else if (nearBottom) messages.scrollTop = messages.scrollHeight;
    const inputKey = JSON.stringify(state.inputs);
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
  find('.eve-mic').addEventListener('click', () => textarea.focus({ preventScroll: true }));
  const stopDraft = promptDraft.subscribe(text => { if (textarea.value !== text) textarea.value = text; render(eve.state); });
  textarea.addEventListener('input', () => promptDraft.set(textarea.value));
  composer.addEventListener('submit', event => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text || !['ready', 'waiting'].includes(eve.state.phase)) return;
    promptDraft.set(''); void eve.send(text).then(() => { if (eve.state.phase === 'error' && !promptDraft.text) promptDraft.set(text); });
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

  find('.eve-stop').addEventListener('click', () => { eveVoice.stop(); void eve.cancel(); });
  find('.eve-retry').addEventListener('click', () => void eve.connect());
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
  return () => { unsubscribe(); for (const card of panelCards.values()) card.dispose(); stopDraft(); eveVoice.stop(); stopVisibility(); shell.remove(); };
}
