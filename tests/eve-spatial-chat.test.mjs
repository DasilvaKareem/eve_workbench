import test from 'node:test';
import assert from 'node:assert/strict';
import { UIKit } from '@iwsdk/core';
import { eve } from '../src/eve-client.ts';
import { mountSpatialChat } from '../src/eve-spatial-chat.ts';

function texts(root) {
  const result = [];
  root.traverse(node => { const value = node.properties?.peek().text; if (typeof value === 'string') result.push(value); });
  return result;
}

test('real native UIKit chat contains requests, rich result cards, and replies in the same viewport', () => {
  const original = { ...eve.state };
  eve.state.messages = []; eve.state.panels = [];
  const viewport = new UIKit.Container({ width: 336, height: 230, flexDirection: 'column', overflow: 'scroll' });
  const chat = mountSpatialChat(viewport);
  const panel = { id: 'inline', title: 'Inline project', blocks: [
    { type: 'text', text: 'This result belongs in the conversation.' },
    { type: 'table', columns: ['Task', 'Status'], rows: [['Review', 'Ready']] },
    { type: 'metrics', items: [{ label: 'Tasks', value: '1' }] },
  ], actions: [] };
  const result = value => eve.applyEvent({ type: 'action.result', data: { status: 'completed', result: { toolName: 'workbench_panel', output: { panels: value } } } });
  try {
    eve.applyEvent({ type: 'message.received', data: { message: 'Show my project', turnId: 't' }, meta: { id: 'question' } });
    viewport.maxScrollPosition.value = [0, 500];
    viewport.scrollPosition.value = [0, 0];
    result([panel]);
    // A tall result must reveal its beginning, rather than jump below its graph.
    viewport.size.value = [336, 230];
    viewport.children[1].size.value = [316, 420];
    viewport.children[1].relativeCenter.value = [0, -295];
    assert.equal(viewport.scrollPosition.peek()[1], 200, 'a fresh result reveals its top');
    eve.applyEvent({ type: 'message.completed', data: { message: 'Here it is.', turnId: 't', stepIndex: 1 } });
    viewport.maxScrollPosition.value = [0, 700];
    assert.equal(viewport.scrollPosition.peek()[1], 200, 'the follow-up must not scroll past the result');
    assert.equal(viewport.children.length, 3);
    assert.ok(texts(viewport.children[0]).includes('Show my project'));
    for (const value of ['Inline project', 'This result belongs in the conversation.', 'Task', 'Review', 'Ready', 'Tasks\n1']) assert.ok(texts(viewport.children[1]).includes(value), value);
    assert.ok(texts(viewport.children[2]).includes('Here it is.'));
    chat.scroll(100);
    assert.equal(viewport.scrollPosition.peek()[1], 300);
    viewport.maxScrollPosition.value = [0, 800];
    assert.equal(viewport.scrollPosition.peek()[1], 300, 'manual scrolling takes precedence over result focus');
    result([{ ...panel, title: 'Updated inline project' }]);
    assert.equal(viewport.children.length, 3);
    assert.ok(texts(viewport.children[1]).includes('Updated inline project'));
    result([]); assert.equal(viewport.children.length, 2);
    assert.ok(texts(viewport.children[1]).includes('Here it is.'));
  } finally { chat.dispose(); assert.equal(viewport.children.length, 0); viewport.dispose(); Object.assign(eve.state, original); }
});
