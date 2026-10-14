import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Quaternion, Vector3 } from '@iwsdk/core';
import { PanelSwipe } from '../src/eve-panel-swipe.ts';
import { bindPanelGestures } from '../src/eve-panel-gestures.ts';

test('page slides require a deliberate horizontal gesture and one matching pointer', () => {
  const swipe = new PanelSwipe();
  assert.equal(swipe.begin(1, 0, 0, 0), true);
  assert.equal(swipe.begin(2, 0, 0, 100), false);
  assert.equal(swipe.end(2, -.12, 0, 200), 0);
  assert.equal(swipe.end(1, -.12, .01, 300), 1);
  assert.equal(swipe.end(1, -.12, .01, 400), 0);
  swipe.begin(1, 0, 0, 0); assert.equal(swipe.end(1, .12, 0, 300), -1);
  for (const [x, y, time] of [[.01, 0, 300], [.1, .1, 300], [.1, 0, 10], [.1, 0, 3000], [1, 0, 300], [NaN, 0, 300]]) {
    swipe.begin(1, 0, 0, 0); assert.equal(swipe.end(1, x, y, time), 0);
  }
  swipe.begin(1, 0, 0, 0); swipe.cancel(); assert.equal(swipe.end(1, -.12, 0, 300), 0);
});

function surface() {
  const object = new Group(), properties = {}, captured = new Set();
  object.setProperties = values => Object.assign(properties, values);
  object.setPointerCapture = id => captured.add(id);
  object.releasePointerCapture = id => captured.delete(id);
  object.hasPointerCapture = id => captured.has(id);
  return { object, properties, captured };
}
function fixture(kind = 'ray') {
  const panel = new Group(); panel.position.set(0, 1.4, -1); panel.scale.setScalar(.24);
  const handle = surface(), hint = surface(), navigation = surface();
  const state = { active: true, page: 0 };
  const binding = bindPanelGestures({ panel, handle: handle.object, hint: hint.object, minScale: .18, maxScale: .34,
    isActive: () => state.active,
    navigation: { surface: navigation.object, previous: () => state.page--, next: () => state.page++, canPrevious: () => state.page > 0, canNext: () => state.page < 2 },
  });
  const send = (target, type, id, x = 0, y = 1.4, z = -1, time = 0, rotation = new Quaternion()) => {
    const point = new Vector3(x, y, z);
    target.object.dispatchEvent({ type, pointerId: id, button: 0, timeStamp: time, point, pointOnFace: point,
      object: target.object, details: { type: kind }, intersection: { details: { type: kind } },
      pointerPosition: point.clone().add(new Vector3(0, 0, .5)), pointerQuaternion: rotation, stopPropagation() {} });
  };
  return { panel, handle, hint, navigation, state, binding, send };
}

test('the real handle library moves the panel, keeps it upright, and releases capture', () => {
  const f = fixture();
  try {
    f.send(f.handle, 'pointerdown', 1);
    assert.ok(f.handle.captured.has(1)); assert.match(f.hint.properties.text, /release to place/);
    f.send(f.handle, 'pointermove', 1, .12, 1.5, -1, 200, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .5));
    f.binding.update(200);
    assert.ok(Math.abs(f.panel.position.x - .12) < 1e-6);
    assert.ok(Math.abs(f.panel.position.y - 1.5) < 1e-6);
    assert.ok(f.panel.quaternion.angleTo(new Quaternion()) < 1e-6);
    f.send(f.handle, 'pointerup', 1, .12, 1.5, -1, 300);
    assert.equal(f.handle.captured.size, 0);
    assert.match(f.hint.properties.text, /Two hands/);
  } finally { f.binding.dispose(); }
});

test('two pinches resize uniformly within limits; coincident and third pointers are ignored', () => {
  const f = fixture();
  try {
    f.send(f.handle, 'pointerdown', 1, -.15);
    f.send(f.handle, 'pointerdown', 9, -.15); assert.equal(f.handle.captured.has(9), false);
    f.send(f.handle, 'pointerdown', 2, .15);
    f.send(f.handle, 'pointerdown', 3, .4); assert.equal(f.handle.captured.has(3), false);
    f.send(f.handle, 'pointermove', 1, -.3, 1.4, -1, 200);
    f.send(f.handle, 'pointermove', 2, .3, 1.4, -1, 200); f.binding.update(200);
    assert.ok(Math.abs(f.panel.scale.x - .34) < 1e-6);
    f.send(f.handle, 'pointermove', 1, -.02, 1.4, -1, 400);
    f.send(f.handle, 'pointermove', 2, .02, 1.4, -1, 400); f.binding.update(400);
    assert.ok(Math.abs(f.panel.scale.x - .18) < 1e-6);
    assert.ok(f.panel.scale.distanceTo(new Vector3(.18, .18, .18)) < 1e-6);
    f.send(f.handle, 'pointercancel', 1);
    assert.equal(f.handle.captured.size, 0);
    const before = f.panel.position.clone();
    f.send(f.handle, 'pointermove', 2, .5, 1.4, -1, 500); f.binding.update(500);
    assert.ok(f.panel.position.equals(before));
  } finally { f.binding.dispose(); }
});

test('SDK pointer captures deliver one page per slide, respect bounds, and cancel on tracking loss', () => {
  const f = fixture();
  try {
    f.send(f.navigation, 'pointerdown', 1);
    f.send(f.navigation, 'pointerdown', 2, .3);
    f.send(f.navigation, 'pointerup', 1, -.12, 1.4, -1, 300);
    assert.equal(f.state.page, 1); assert.equal(f.navigation.captured.size, 0);
    f.send(f.navigation, 'pointerup', 1, -.12, 1.4, -1, 400); assert.equal(f.state.page, 1);
    f.send(f.navigation, 'pointerdown', 1);
    f.send(f.navigation, 'pointercancel', 1); f.send(f.navigation, 'pointerup', 1, -.12, 1.4, -1, 300);
    assert.equal(f.state.page, 1);
    f.send(f.navigation, 'pointerdown', 1);
    f.state.active = false; f.binding.update(200);
    assert.equal(f.navigation.captured.size, 0);
    f.send(f.navigation, 'pointerup', 1, -.12, 1.4, -1, 300); assert.equal(f.state.page, 1);
    f.state.active = true; f.state.page = 0;
    f.send(f.navigation, 'pointerdown', 1); f.send(f.navigation, 'pointerup', 1, .12, 1.4, -1, 300);
    assert.equal(f.state.page, 0);
    f.state.page = 2;
    f.send(f.navigation, 'pointerdown', 1); f.send(f.navigation, 'pointerup', 1, -.12, 1.4, -1, 300);
    assert.equal(f.state.page, 2);
  } finally { f.binding.dispose(); }
  for (const target of [f.handle, f.navigation]) for (const listeners of Object.values(target.object._listeners)) assert.equal(listeners.length, 0);
});

test('page directions follow a rotated panel rather than fixed room axes', () => {
  const f = fixture();
  try {
    f.panel.rotation.y = Math.PI / 2; f.panel.updateMatrixWorld(true);
    f.send(f.navigation, 'pointerdown', 1);
    f.send(f.navigation, 'pointerup', 1, 0, 1.4, -.88, 300);
    assert.equal(f.state.page, 1);
  } finally { f.binding.dispose(); }
});

test('near fingertip pointer gestures use the same navigation without a far ray', () => {
  const f = fixture('sphere');
  try {
    f.send(f.navigation, 'pointerdown', 1);
    f.send(f.navigation, 'pointerup', 1, -.12, 1.4, -1, 300);
    assert.equal(f.state.page, 1);
    f.send(f.handle, 'pointerdown', 1);
    f.send(f.handle, 'pointermove', 1, .1, 1.4, -1, 500); f.binding.update(500);
    assert.ok(Math.abs(f.panel.position.x - .1) < 1e-6);
  } finally { f.binding.dispose(); }
});
