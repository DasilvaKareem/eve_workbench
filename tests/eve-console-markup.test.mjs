import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUIKitMLSource } from '@iwsdk/core';

test('the real SDK parser accepts the editable prompt for the Quest native keyboard', () => {
  const source = readFileSync(new URL('../public/ui/eve-console.uikitml', import.meta.url), 'utf8');
  assert.doesNotThrow(() => parseUIKitMLSource(source, 'http://localhost/ui/eve-console.uikitml'));
  assert.match(source, /<textarea[^>]+placeholder="Talk or type"/);
  assert.doesNotMatch(source, /eve-key-|eve-xr-keyboard/);
});

test('the real SDK parser accepts the watch-only browser panel', () => {
  const source = readFileSync(new URL('../public/ui/eve-browser.uikitml', import.meta.url), 'utf8');
  assert.doesNotThrow(() => parseUIKitMLSource(source, 'http://localhost/ui/eve-browser.uikitml'));
});
