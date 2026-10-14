import test from 'node:test';
import assert from 'node:assert/strict';
import { bindNativeInput } from '../src/eve-native-input.ts';

test('native input stays in the viewport, focuses synchronously, reads OS edits and releases listeners', () => {
  const events = new Map(), seen = [];
  const element = { style: {}, value: '', focus(options) { this.focusOptions = options; }, blur() { this.blurred = true; },
    setAttribute() {}, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } };
  const native = bindNativeInput(element, text => seen.push(text));
  native.open(); assert.deepEqual(element.focusOptions, { preventScroll: true });
  assert.equal(element.style.left, '0'); assert.equal(element.enterKeyHint, 'done');
  element.value = 'Quest dictation'; events.get('input')();
  element.value = 'Final native text'; events.get('blur')();
  assert.deepEqual(seen, ['Quest dictation', 'Final native text']);
  native.dispose(); assert.equal(events.size, 0); assert.equal(element.blurred, true);
});
