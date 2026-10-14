import test from 'node:test';
import assert from 'node:assert/strict';
import { EveClient } from '../src/eve-client.ts';
import { taskSnapshot } from '../src/eve-task-charts.ts';
import { handleEveRequest } from '../server/eve-proxy.mjs';
import { ReplyVoice } from '../src/eve-reply-voice.ts';

test('proxy and client publish text, speech sentences, tasks and generated panels before completion', { timeout: 3000 }, async () => {
  let upstream;
  let streamClosed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { upstream = controller; },
    cancel() { streamClosed = true; },
  });
  const env = { NODE_ENV: 'development', EVE_AGENT_URL: 'http://127.0.0.1:2000' };
  const paths = [];
  const client = new EveClient(async (path, options) => handleEveRequest(
    new Request(`http://localhost:5173${path}`, options), env,
    async url => {
      paths.push(url.pathname);
      if (url.pathname === '/eve/v1/session') return Response.json({ sessionId: 'wrun_live' }, { status: 202 });
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'x-eve-stream-version': '26' } });
    },
  ));
  const spoken = [];
  const voice = new ReplyVoice(client, {
    getVoices: () => [], cancel() {}, speak: speech => spoken.push(speech), addEventListener() {}, removeEventListener() {},
  }, text => ({ text }));
  let id = 0;
  const emit = (type, data) => upstream.enqueue(encoder.encode(`${JSON.stringify({ type, data, meta: { id: `evt_${++id}` } })}\n`));
  const waitFor = predicate => new Promise(resolve => {
    let stop = () => {};
    stop = client.subscribe(state => { if (predicate(state)) { queueMicrotask(() => stop()); resolve(); } });
  });
  client.state.phase = 'ready';
  try {
    voice.setEnabled(true); spoken[0].onend();
    await client.send('Track the panel work');
    const partial = waitFor(state => state.messages.some(message => message.text === 'Saving your task.'));
    emit('turn.started', { turnId: 'turn_live', sequence: 0 });
    emit('message.received', { turnId: 'turn_live', sequence: 1, message: 'Track the panel work' });
    emit('message.appended', { turnId: 'turn_live', stepIndex: 0, sequence: 2, messageDelta: 'Saving your task.' });
    await partial;
    assert.equal(spoken.at(-1).text, 'Saving your task.');
    assert.equal(client.state.phase, 'working');
    assert.equal(streamClosed, false);

    const task = { id: 'task_live', title: 'Review the panel', status: 'todo' };
    const board = waitFor(state => state.tasks.length === 1);
    emit('action.result', { turnId: 'turn_live', stepIndex: 0, sequence: 3, status: 'completed',
      result: { kind: 'tool-result', callId: 'call_live', toolName: 'task_board', output: { tasks: [task] } } });
    await board;
    assert.equal(taskSnapshot(client.state.tasks).counts.todo, 1);
    assert.equal(client.state.phase, 'working');
    assert.equal(streamClosed, false);

    const panel = waitFor(state => state.panels.length === 1);
    emit('action.result', { turnId: 'turn_live', stepIndex: 0, sequence: 4, status: 'completed',
      result: { kind: 'tool-result', callId: 'panel_live', toolName: 'workbench_panel', output: { panels: [{ id: 'review', title: 'Review plan',
        blocks: [{ type: 'text', text: 'Review the panel together.' }], actions: [{ label: 'Next step', prompt: 'Suggest my next step.' }] }] } } });
    await panel;
    assert.equal(client.state.panels[0].title, 'Review plan');
    assert.equal(client.state.phase, 'working');
    assert.equal(streamClosed, false);

    const ready = waitFor(state => state.phase === 'ready');
    emit('message.completed', { turnId: 'turn_live', stepIndex: 0, sequence: 5, message: 'Saved “Review the panel”. Open Progress to see its status.' });
    emit('session.waiting', {});
    await ready;
    assert.equal(client.state.messages.filter(message => message.role === 'assistant').length, 1);
    assert.match(client.state.messages.find(message => message.role === 'assistant').text, /^Saved/);
    assert.equal(client.state.messages.find(message => message.role === 'panel').panel.id, 'review');
    assert.ok(paths.includes('/eve/v1/session/wrun_live/stream'));
    assert.equal(streamClosed, false);
  } finally { voice.dispose(); client.dispose(); }
});
