import test from 'node:test';
import assert from 'node:assert/strict';
import { EveClient } from '../src/eve-client.ts';

const event = (type, data, id) => ({ type, data, meta: { id } });

test('browser timeline uses authoritative call ids, hides field values, and stays bounded', () => {
  const client = new EveClient();
  client.applyEvent(event('actions.requested', { turnId: 'turn_1', actions: [{ toolName: 'browser', callId: 'fill_1', input: { operation: 'fill', text: 'a-private-password' } }] }));
  assert.deepEqual(client.state.browserActions, [{ id: 'turn_1:fill_1', tool: 'fill', status: 'running' }]);
  assert.ok(!JSON.stringify(client.state.browserActions).includes('a-private-password'));
  client.applyEvent(event('action.result', { turnId: 'turn_1', status: 'completed', result: { callId: 'fill_1', toolName: 'browser' } }));
  assert.equal(client.state.browserActions[0].status, 'completed');
  for (let index = 0; index < 35; index++) client.applyEvent(event('actions.requested', { turnId: 'turn_1', actions: [{ toolName: 'browser', callId: `call_${index}`, input: { operation: 'snapshot' } }] }));
  assert.equal(client.state.browserActions.length, 30);
  client.applyEvent(event('turn.cancelled', {}));
  assert.ok(client.state.browserActions.every(item => item.status === 'cancelled'));
  client.dispose();
});

test('stream deltas and authoritative completion form one message despite changing sequence', () => {
  const client = new EveClient();
  client.applyEvent(event('turn.started', { turnId: 'turn_0', sequence: 0 }));
  client.applyEvent(event('message.appended', { turnId: 'turn_0', stepIndex: 0, sequence: 1, messageDelta: 'Hello ' }));
  client.applyEvent(event('message.appended', { turnId: 'turn_0', stepIndex: 0, sequence: 2, messageDelta: 'world' }));
  assert.equal(client.state.messages.length, 1);
  assert.equal(client.state.messages[0].text, 'Hello world');
  client.applyEvent(event('message.completed', { turnId: 'turn_0', stepIndex: 0, sequence: 3, message: 'Hello, world!' }));
  assert.equal(client.state.messages[0].text, 'Hello, world!');
  assert.equal(client.state.phase, 'working');
  client.applyEvent(event('message.completed', { turnId: 'turn_0', stepIndex: 1, sequence: 4, message: 'After using a tool.' }));
  assert.equal(client.state.messages.length, 2);
  client.applyEvent(event('session.waiting', {}));
  assert.equal(client.state.phase, 'ready');
  client.dispose();
});

test('task board and approval options come from actual protocol results', () => {
  const client = new EveClient();
  const tasks = [{ id: 't1', title: 'Review the scene', status: 'todo' }];
  client.applyEvent(event('action.result', { status: 'completed', result: { toolName: 'task_board', output: { tasks } } }));
  assert.deepEqual(client.state.tasks, tasks);
  client.applyEvent(event('input.requested', { requests: [{ requestId: 'approval_1', prompt: 'Approve this action?', options: [{ id: 'approve', label: 'Approve' }, { id: 'deny', label: 'Deny' }] }] }));
  assert.equal(client.state.phase, 'waiting');
  assert.equal(client.state.inputs[0].title, 'Approve this action?');
  assert.deepEqual(client.state.inputs[0].options.map(x => x.id), ['approve', 'deny']);
  client.applyEvent(event('input.requested', { requests: [{ requestId: 'question_2', prompt: 'Which project?', options: [{ id: 'project_a', label: 'Project A' }] }] }));
  assert.equal(client.state.inputs.length, 2);
  client.applyEvent(event('input.resolved', { resolutions: [{ requestId: 'approval_1', outcome: 'denied' }] }));
  assert.equal(client.state.inputs.length, 1);
  assert.equal(client.state.inputs[0].id, 'question_2');
  client.dispose();
});

test('new session preserves UTF-8 across stream chunks and deduplicates optimistic input', async () => {
  const received = [];
  const events = [
    event('turn.started', { turnId: 'turn_0', sequence: 0 }, 'evt_1'),
    event('message.received', { message: 'Hello', turnId: 'turn_0', sequence: 1 }, 'evt_2'),
    event('message.appended', { messageDelta: 'Hello 🌍', turnId: 'turn_0', stepIndex: 0, sequence: 2 }, 'evt_3'),
    event('message.completed', { message: 'Hello 🌍', turnId: 'turn_0', stepIndex: 0, sequence: 3 }, 'evt_4'),
    event('session.waiting', {}, 'evt_5'),
  ];
  const bytes = new TextEncoder().encode(events.map(x => JSON.stringify(x)).join('\n') + '\n');
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const client = new EveClient(async (path, options) => {
    received.push(path);
    if (path === '/api/eve/session') return Response.json({ sessionId: 'wrun_test' }, { status: 202 });
    return new Response(new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
        // Leave the live stream parked until the client closes it.
      },
    }), { headers: { 'x-eve-stream-version': '26' } });
  });
  client.state.phase = 'ready';
  const unsubscribe = client.subscribe(state => { if (state.phase === 'ready' && state.messages.length === 2) finish(); });
  try {
    await client.send('Hello');
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('stream did not settle')), 2000).unref())]);
    assert.deepEqual(client.state.messages.map(x => x.text), ['Hello', 'Hello 🌍']);
    assert.ok(received.includes('/api/eve/session/wrun_test/stream?startIndex=0'));
  } finally { unsubscribe(); client.dispose(); }
});

test('backend setup and authentication failures remain visible', async () => {
  const setup = new EveClient(async () => Response.json({ configured: false, authenticated: false }));
  await setup.connect(); assert.equal(setup.state.phase, 'setup'); setup.dispose();
  const locked = new EveClient(async () => Response.json({ configured: true, authenticated: false, authRequired: true }));
  await locked.connect(); assert.equal(locked.state.phase, 'locked'); locked.dispose();
});

test('a dropped stream reconnects from its absolute cursor without repeating the turn', async () => {
  const paths = [];
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const first = [
    event('turn.started', { turnId: 'turn_0', sequence: 0 }, 'evt_1'),
    event('message.received', { message: 'Continue', turnId: 'turn_0', sequence: 1 }, 'evt_2'),
    event('message.appended', { messageDelta: 'One ', turnId: 'turn_0', stepIndex: 0, sequence: 2 }, 'evt_3'),
  ];
  const second = [
    event('message.appended', { messageDelta: 'two', turnId: 'turn_0', stepIndex: 0, sequence: 3 }, 'evt_4'),
    event('message.completed', { message: 'One two', turnId: 'turn_0', stepIndex: 0, sequence: 4 }, 'evt_5'),
    event('session.waiting', {}, 'evt_6'),
  ];
  const client = new EveClient(async path => {
    paths.push(path);
    if (path === '/api/eve/session') return Response.json({ sessionId: 'wrun_reconnect' }, { status: 202 });
    const initial = path.endsWith('startIndex=0');
    const bytes = new TextEncoder().encode((initial ? first : second).map(x => JSON.stringify(x)).join('\n') + '\n');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); if (initial) controller.close(); } }), { headers: { 'x-eve-stream-version': '26' } });
  });
  client.state.phase = 'ready';
  const stop = client.subscribe(state => { if (state.phase === 'ready' && state.messages.length === 2) complete(); });
  try {
    await client.send('Continue');
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('reconnect did not complete')), 3000).unref())]);
    assert.ok(paths.includes('/api/eve/session/wrun_reconnect/stream?startIndex=3'));
    assert.equal(paths.filter(path => path === '/api/eve/session').length, 1);
    assert.deepEqual(client.state.messages.map(x => x.text), ['Continue', 'One two']);
  } finally { stop(); client.dispose(); }
});
