import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptDraft, promptDraft } from '../src/eve-prompt.ts';
import { EveConsoleSystem } from '../src/eve-console-system.ts';
import { eve } from '../src/eve-client.ts';
import { UIKit } from '@iwsdk/core';

// The real system wires these events; no duplicated keyboard implementation.
function element() {
  const events = new Map(), properties = {};
  return { properties, events, element: { style: {}, value: '', setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() { this.focused = true; }, blur() {} },
    setProperties(next) { Object.assign(properties, next); if (typeof next.value === 'string') this.element.value = next.value; }, blur() {},
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); },
    click() { for (const fn of events.get('click') || []) fn(); },
  };
}

test('a shared prompt preserves browser edits, Unicode deletion, and bounded drafts', () => {
  const draft = new PromptDraft(), seen = [];
  const stop = draft.subscribe(value => seen.push(value));
  draft.set('Hello'); draft.insert(' 🌍'); draft.backspace();
  assert.equal(draft.text, 'Hello ');
  assert.deepEqual(seen, ['', 'Hello', 'Hello 🌍', 'Hello ']);
  draft.set('a'.repeat(13000)); assert.equal(draft.text.length, 12000);
  stop(); draft.set(''); assert.equal(seen.length, 5);
});

test('XR field focuses Quest native input, reads native value on Send, and cleans up', async () => {
  const elements = new Map();
  const viewport = new UIKit.Container({ width: 336, height: 230, overflow: 'scroll' });
  const get = id => { if (!elements.has(id)) elements.set(id, id === 'eve-xr-transcript' ? viewport : element()); return elements.get(id); };
  const panel = { visible: false, requireElementById: get, dispose() {} };
  const components = [], cleanups = [];
  let destroyed = false, exit = false, sent = [];
  const entity = { addComponent(component) { components.push(component); }, dispose() { destroyed = true; } };
  const state = { ...eve.state }, originalSend = eve.send;
  eve.state.phase = 'ready'; eve.state.messages = []; eve.state.error = null;
  eve.send = async text => { sent.push(text); };
  const system = { cleanupFuncs: cleanups, world: {
    input: { xr: { gazeEnabled: true } },
    assets: { instantiate: async () => panel }, createTransformEntity: () => entity,
    visibilityState: { subscribe: fn => { fn('NonImmersive'); return () => {}; } },
    exitXR: async () => { exit = true; },
  } };
  try {
    promptDraft.set('');
    EveConsoleSystem.prototype.init.call(system);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(system.world.input.xr.gazeEnabled, false, 'hand pointing stays primary');
    assert.equal(components.length, 2, 'ray and poke stay enabled on the UI root');
    assert.ok(get('eve-xr-handle').events.get('pointerdown').size > 0, 'the title captures manipulation');
    assert.equal(get('eve-xr-prompt').events.get('pointerdown')?.size || 0, 0, 'the editable field is separate from manipulation');
    get('eve-xr-prompt').click();
    assert.equal(get('eve-xr-prompt').element.focused, true);
    get('eve-xr-prompt').properties.onValueChange('Typed on a physical keyboard');
    assert.equal(promptDraft.text, 'Typed on a physical keyboard');
    get('eve-xr-prompt').element.value = 'Native dictation result';
    get('eve-xr-send').click(); get('eve-xr-send').click();
    assert.deepEqual(sent, ['Native dictation result']);
    assert.equal(promptDraft.text, '');
    assert.equal(elements.has('eve-xr-keyboard'), false, 'no custom keyboard is loaded');
    get('eve-xr-exit').click(); assert.equal(exit, true);
    for (const cleanup of cleanups) cleanup();
    assert.equal(system.world.input.xr.gazeEnabled, true, 'the previous input mode is restored on teardown');
    assert.equal(destroyed, true);
    assert.equal(get('eve-xr-prompt').events.get('click').size, 0);
  } finally { viewport.dispose(); Object.assign(eve.state, state); eve.send = originalSend; promptDraft.set(''); }
});
