import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptDraft, promptDraft } from '../src/eve-prompt.ts';
import { EveConsoleSystem } from '../src/eve-console-system.ts';
import { eve } from '../src/eve-client.ts';

// The real system wires these events; no duplicated keyboard implementation.
function element() {
  const events = new Map(), properties = {};
  return { properties, events, element: { setAttribute() {}, addEventListener() {}, removeEventListener() {} },
    setProperties(next) { Object.assign(properties, next); }, blur() {},
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

test('XR field opens a working keyboard, edits the same draft, sends once, and cleans up', async () => {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const panel = { visible: false, requireElementById: get, dispose() {} };
  const components = [], cleanups = [];
  let destroyed = false, exit = false, sent = [];
  const entity = { addComponent(component) { components.push(component); }, dispose() { destroyed = true; } };
  const state = { ...eve.state }, originalSend = eve.send;
  eve.state.phase = 'ready'; eve.state.messages = []; eve.state.error = null;
  eve.send = async text => { sent.push(text); };
  const system = { cleanupFuncs: cleanups, world: {
    assets: { instantiate: async () => panel }, createTransformEntity: () => entity,
    visibilityState: { subscribe: fn => { fn('NonImmersive'); return () => {}; } },
    exitXR: async () => { exit = true; },
  } };
  try {
    promptDraft.set('');
    EveConsoleSystem.prototype.init.call(system);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(components.length, 2, 'ray and poke stay enabled on the UI root');
    assert.ok(get('eve-xr-handle').events.get('pointerdown').size > 0, 'the title captures manipulation');
    assert.equal(get('eve-xr-prompt').events.get('pointerdown')?.size || 0, 0, 'the editable field is separate from manipulation');
    get('eve-xr-prompt').click();
    assert.equal(get('eve-xr-keyboard').properties.display, 'flex');
    get('eve-key-1-5').click(); // y
    get('eve-key-2-7').click(); // k
    get('eve-key-backspace').click();
    get('eve-key-space').click();
    get('eve-key-shift').click();
    get('eve-key-1-0').click(); // Q
    assert.equal(promptDraft.text, 'y Q');
    assert.equal(get('eve-xr-prompt').properties.value, 'y Q');
    get('eve-xr-prompt').properties.onValueChange('Typed on a physical keyboard');
    assert.equal(promptDraft.text, 'Typed on a physical keyboard');
    get('eve-xr-send').click(); get('eve-xr-send').click();
    assert.deepEqual(sent, ['Typed on a physical keyboard']);
    assert.equal(promptDraft.text, '');
    assert.equal(get('eve-xr-keyboard').properties.display, 'none');
    get('eve-xr-exit').click(); assert.equal(exit, true);
    for (const cleanup of cleanups) cleanup();
    assert.equal(destroyed, true);
    assert.equal(get('eve-key-1-0').events.get('click').size, 0);
  } finally { Object.assign(eve.state, state); eve.send = originalSend; promptDraft.set(''); }
});
