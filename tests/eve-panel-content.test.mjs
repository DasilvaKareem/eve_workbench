import test from 'node:test';
import assert from 'node:assert/strict';
import { paginatePanelText } from '../src/eve-panel-content.ts';

test('long replies remain fully readable across bounded spatial pages', () => {
  const text = Array.from({ length: 300 }, (_, index) => `task${index}`).join(' ');
  const pages = paginatePanelText(text);
  assert.ok(pages.length > 1);
  assert.equal(pages.join('\n').split(/\s+/).join(' '), text);
  for (const page of pages) {
    const lines = page.split('\n');
    assert.ok(lines.length <= 8);
    assert.ok(lines.every(line => Array.from(line).length <= 42));
  }
});

test('long tokens and emoji survive pagination without broken surrogate pairs', () => {
  const text = '🌍'.repeat(400);
  const pages = paginatePanelText(text);
  assert.equal(pages.join('').replaceAll('\n', ''), text);
  assert.ok(pages.every(page => !page.includes('\uFFFD')));
});

test('blank paragraphs and Windows line endings retain their structure', () => {
  assert.deepEqual(paginatePanelText('First\r\n\r\nSecond'), ['First\n\nSecond']);
  assert.deepEqual(paginatePanelText(''), ['']);
  assert.throws(() => paginatePanelText('hello', 0), RangeError);
});
