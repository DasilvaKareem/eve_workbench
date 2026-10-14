import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group, Quaternion, Vector3, UIKit, parseUIKitMLSource, VisibilityState } from '@iwsdk/core';
import { EveClient, eve } from '../src/eve-client.ts';
import { WorkspaceWindows, workspaceWindows } from '../src/eve-windows.ts';
import { EveWindowSystem } from '../src/eve-window-system.ts';
import { EveFloatingWindow } from '../src/eve-window-component.ts';

const panel = (id, title = id) => ({ id, title, blocks: [{ type: 'text', text: `Content for ${title}` }], actions: [] });
const result = (client, panels, extra = {}, status = 'completed') => client.applyEvent({ type: 'action.result', data: { status,
  result: { toolName: 'workbench_panel', output: { panels, ...extra } } } });

test('independent windows open, update in place, close without removing chat, and honor explicit reopen', () => {
  const client = new EveClient(), windows = new WorkspaceWindows(client);
  try {
    const a = panel('a'), b = panel('b');
    result(client, [a, b], { openWindowId: 'a' });
    result(client, [a, b], { openWindowId: 'b' });
    assert.equal(windows.entries.length, 2);
    const firstId = windows.entries[0].id, secondId = windows.entries[1].id;
    result(client, [panel('a', 'Updated'), b], { updatedPanelId: 'a' });
    assert.equal(windows.entries[0].id, firstId); assert.equal(windows.entries[0].panel.title, 'Updated');
    windows.close(firstId);
    assert.equal(windows.entries.length, 1); assert.equal(windows.entries[0].id, secondId);
    assert.ok(client.state.messages.some(message => message.panel?.id === 'a'), 'closing preserves the inline card');
    result(client, [a, b]); assert.equal(windows.entries.length, 1, 'unrelated snapshots do not reopen closed windows');
    result(client, [a, b], { openWindowId: 'a' }); assert.equal(windows.entries.length, 2);
    result(client, [a]); assert.equal(windows.entries.length, 1, 'removing a panel also disposes its window');
    result(client, [{ ...a, blocks: [] }], { openWindowId: 'a' }); assert.equal(windows.entries.length, 1);
    result(client, [a, b], { openWindowId: 'b' }, 'failed'); assert.equal(windows.entries.length, 1);
  } finally { windows.dispose(); client.dispose(); }
});

test('new blank windows fill from generated UI, stay bounded, and clear with their conversation', () => {
  const client = new EveClient(), windows = new WorkspaceWindows(client);
  try {
    const id = windows.create();
    client.state.sessionId = 'session_one';
    result(client, [panel('a')], { updatedPanelId: 'a' });
    assert.equal(windows.entries[0].id, id); assert.equal(windows.entries[0].panel.id, 'a');
    for (let i = 0; i < 5; i++) windows.create();
    assert.equal(windows.entries.length, 6); assert.equal(windows.create(), undefined);
    const lastId = windows.entries[5].id;
    result(client, [panel('a'), panel('b')], { updatedPanelId: 'b', openWindowId: 'b' });
    assert.equal(windows.entries.length, 6); assert.equal(windows.entries[5].id, lastId); assert.equal(windows.entries[5].panel.id, 'b');
    client.state.sessionId = 'session_two'; result(client, []);
    assert.equal(windows.entries.length, 0);
  } finally { windows.dispose(); client.dispose(); }
});

test('the real SDK parser accepts the independent window controls', () => {
  assert.doesNotThrow(() => parseUIKitMLSource(readFileSync(new URL('../public/ui/eve-window.uikitml', import.meta.url), 'utf8'), 'http://localhost/ui/eve-window.uikitml'));
});

test('XR creates distinct interactive roots, places them apart, preserves moved transforms, and disposes a closed window', async () => {
  const original = { ...eve.state };
  eve.state.messages = []; eve.state.panels = [];
  const entities = new Set(), panels = [], cleanups = [], visibility = new Set();
  const makePanel = () => {
    const root = new Group(), elements = new Map();
    root.requireElementById = id => {
      if (!elements.has(id)) elements.set(id, id === 'window-content' ? new UIKit.Container({ width: 336, height: 270, overflow: 'scroll', flexDirection: 'column' }) : new UIKit.Text({ text: id }));
      return elements.get(id);
    };
    root.dispose = () => { for (const node of elements.values()) node.dispose(); root.disposed = true; }; panels.push(root); return root;
  };
  const world = {
    assets: { instantiate: async id => { assert.equal(id, 'eve-window'); return makePanel(); } },
    visibilityState: { peek: () => VisibilityState.Visible, subscribe: fn => { visibility.add(fn); fn(VisibilityState.Visible); return () => visibility.delete(fn); } },
    createTransformEntity: root => {
      const components = new Map();
      const entity = { root, components, addComponent(type, props) { components.set(type, props); }, getValue(type, key) { return components.get(type)[key]; }, dispose() { entities.delete(entity); root.dispose(); } };
      entities.add(entity); return entity;
    },
  };
  const system = { world, cleanupFuncs: cleanups, queries: { windows: { entities } }, views: new Map(), loading: new Set(),
    eye: new Vector3(), forward: new Vector3(), direction: new Vector3(), orientation: new Quaternion(),
    input: { xr: { gamepads: {} } }, player: new Group(), xrManager: {
      getReferenceSpace: () => ({}), getFrame: () => ({ getViewerPose: () => ({ transform: { position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) }),
    },
  };
  try {
    EveWindowSystem.prototype.init.call(system);
    const first = workspaceWindows.create(), second = workspaceWindows.create();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entities.size, 2); assert.notEqual(panels[0], panels[1]);
    for (const entity of entities) assert.equal(entity.components.size, 3, 'own window identity, ray, and poke components');
    EveWindowSystem.prototype.update.call(system, 0, 1);
    assert.ok(panels.every(root => root.visible)); assert.ok(panels[0].position.distanceTo(panels[1].position) > 1);
    panels[0].position.x = 3; panels[0].scale.setScalar(.3);
    result(eve, [panel('one'), panel('two')], { updatedPanelId: 'one' });
    result(eve, [panel('one'), panel('two')], { updatedPanelId: 'two' });
    const titles = panels.map(root => root.requireElementById('window-title').properties.peek().text);
    assert.deepEqual(titles.sort(), ['one', 'two'], 'each root gets its own generated content');
    EveWindowSystem.prototype.update.call(system, 0, 2);
    assert.equal(panels[0].position.x, 3); assert.equal(panels[0].scale.x, .3, 'manual placement is not overwritten each frame');
    const firstEntity = [...entities].find(entity => entity.getValue(EveFloatingWindow, 'windowId') === first);
    firstEntity.root.requireElementById('window-close').dispatchEvent({ type: 'click' });
    assert.equal(entities.size, 1); assert.equal(firstEntity.root.disposed, true);
    assert.equal(workspaceWindows.entries[0].id, second);
    for (const cleanup of cleanups) cleanup();
    assert.equal(entities.size, 0); assert.equal(visibility.size, 0);
  } finally {
    for (const entry of [...workspaceWindows.entries]) workspaceWindows.close(entry.id);
    Object.assign(eve.state, original);
  }
});

test('closing while an XR asset loads does not leave an orphan window', async () => {
  const cleanups = [], entities = new Set(); let resolveAsset, created = 0, disposed = false;
  const system = { cleanupFuncs: cleanups, queries: { windows: { entities } }, views: new Map(), loading: new Set(), world: {
    assets: { instantiate: () => new Promise(resolve => { resolveAsset = resolve; }) },
    createTransformEntity() { created++; },
    visibilityState: { subscribe: () => () => {} },
  } };
  try {
    EveWindowSystem.prototype.init.call(system);
    const id = workspaceWindows.create(); workspaceWindows.close(id);
    resolveAsset({ dispose() { disposed = true; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(created, 0); assert.equal(disposed, true);
  } finally { for (const cleanup of cleanups) cleanup(); }
});
