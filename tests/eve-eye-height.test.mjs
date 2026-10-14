import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Group } from '@iwsdk/core';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { EyeHeightController } from '../src/eve-eye-height.ts';

// The scene source contains constructor parameter properties; use its normal TS transform.
const source = readFileSync(new URL('../src/scene-assets/cafe.scene-asset.ts', import.meta.url), 'utf8');
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020 } }).outputText
  .replaceAll("'@iwsdk/core'", JSON.stringify(import.meta.resolve('@iwsdk/core')));
const { cafeWorkbench } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function rig(height = .4) {
  const resets = new Set();
  const base = { offset: 0, addEventListener(_name, fn) { resets.add(fn); }, removeEventListener(_name, fn) { resets.delete(fn); },
    getOffsetReferenceSpace(transform) { return { ...this, offset: -transform.position.y }; } };
  let reference = base, session = {}, rawHeight = height, tracked = true, writes = 0;
  const manager = { getSession: () => session, getReferenceSpace: () => reference, setReferenceSpace(value) { reference = value; writes++; } };
  const frame = { getViewerPose: space => tracked ? { transform: { position: { x: 0, y: rawHeight + space.offset, z: 0 } } } : null };
  const player = new Group(), changes = [];
  const controller = new EyeHeightController(manager, player, height => changes.push(height), offset => ({ position: { y: -offset } }));
  return { manager, frame, player, controller, base, resets, changes, get writes() { return writes; },
    get height() { return frame.getViewerPose(reference).transform.position.y + player.position.y; },
    setHeight(value) { rawHeight = value; }, setTracked(value) { tracked = value; },
    restart() { session = {}; reference = base; },
  };
}

test('a low or seated XR origin is raised well above the actual workbench surface', () => {
  const r = rig(.4);
  try {
    const top = new Box3().setFromObject(cafeWorkbench).max.y;
    assert.ok(r.height < top, 'the reported low viewpoint is reproduced');
    assert.equal(r.controller.update(r.frame), true);
    assert.ok(r.height > top + .6, 'eyes clear the workbench comfortably');
    assert.equal(r.height, 1.75);
    const handBefore = .15, handAfter = handBefore + r.manager.getReferenceSpace().offset;
    assert.ok(Math.abs((r.height - handAfter) - (.4 - handBefore)) < 1e-9, 'the camera and tracked hands retain the same relative height');
  } finally { r.controller.dispose(); }
});

test('height calibration preserves later head motion and manual changes do not compound offsets', () => {
  const r = rig(.4);
  try {
    r.controller.update(r.frame); const writes = r.writes;
    r.setHeight(.2); r.controller.update(r.frame);
    assert.equal(r.writes, writes, 'ordinary head movement does not trigger artificial lifting');
    assert.ok(Math.abs(r.height - 1.55) < 1e-9);
    r.setHeight(.4); r.controller.adjust(.15); r.controller.update(r.frame);
    assert.ok(Math.abs(r.height - 1.9) < 1e-9);
    r.controller.adjust(-.15); r.controller.update(r.frame); assert.ok(Math.abs(r.height - 1.75) < 1e-9);
    r.restart(); r.controller.update(r.frame); assert.ok(Math.abs(r.height - 1.75) < 1e-9, 're-entering XR does not double the boost');
  } finally { r.controller.dispose(); }
  assert.equal(r.resets.size, 0); assert.equal(r.manager.getReferenceSpace(), r.base);
});

test('tracking can arrive late without lowering a standing user', () => {
  const r = rig(1.95);
  try {
    r.setTracked(false); assert.equal(r.controller.update(r.frame), false);
    r.setTracked(true); r.controller.update(r.frame);
    assert.equal(r.height, 1.95); assert.equal(r.writes, 0);
  } finally { r.controller.dispose(); }
});

test('origin resets and locomotion translations calibrate in world coordinates', () => {
  const r = rig(.4); r.player.position.y = -.2;
  try {
    r.controller.update(r.frame); assert.ok(Math.abs(r.height - 1.75) < 1e-9);
    r.setHeight(.1); for (const reset of r.resets) reset();
    r.controller.update(r.frame); assert.ok(Math.abs(r.height - 1.75) < 1e-9);
  } finally { r.controller.dispose(); }
});
