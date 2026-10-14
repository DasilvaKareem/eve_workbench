import { Vector3, type Object3D, type WebXRManager } from '@iwsdk/core';

const KEY = 'eve-workbench.eye-height.v1';
const DEFAULT_HEIGHT = 1.75;
const clamp = (height: number) => Math.max(1.1, Math.min(2.6, height));

/** Calibrate the tracked space, moving the eyes and hands together above the desk. */
export class EyeHeightController {
  targetHeight = DEFAULT_HEIGHT;
  private manager: WebXRManager;
  private player: Object3D;
  private onChange: (height: number) => void;
  private transform: (offset: number) => XRRigidTransform;
  private session: XRSession | null = null;
  private base: XRReferenceSpace | null = null;
  private offset = 0;
  private dirty = true;
  private explicitHeight = false;
  private initial = true;
  private eye = new Vector3();
  private reset = () => { this.dirty = true; };

  constructor(manager: WebXRManager, player: Object3D, onChange = (_height: number) => {},
    transform = (offset: number) => new XRRigidTransform({ y: -offset })) {
    this.manager = manager; this.player = player; this.onChange = onChange; this.transform = transform;
    try {
      const saved = globalThis.localStorage?.getItem(KEY);
      if (saved && Number.isFinite(Number(saved))) { this.targetHeight = clamp(Number(saved)); this.explicitHeight = true; }
    } catch { /* Storage may be disabled. Height controls still work. */ }
    this.onChange(this.targetHeight);
  }

  adjust(amount: number) {
    this.targetHeight = clamp(this.targetHeight + amount); this.explicitHeight = true; this.dirty = true;
    try { globalThis.localStorage?.setItem(KEY, String(this.targetHeight)); } catch { /* Optional persistence. */ }
    this.onChange(this.targetHeight);
  }

  recenter() { this.dirty = true; }

  update(frame: XRFrame): boolean {
    const session = this.manager.getSession(), reference = this.manager.getReferenceSpace();
    if (!session || !reference) return false;
    const starting = session !== this.session;
    if (starting) {
      this.base?.removeEventListener('reset', this.reset);
      this.session = session; this.base = reference; this.offset = 0; this.dirty = true; this.initial = true;
      this.base.addEventListener('reset', this.reset);
    }
    if (!this.dirty) return false;
    const pose = frame.getViewerPose(reference); if (!pose) return false;
    this.player.updateWorldMatrix(true, false);
    const position = pose.transform.position;
    this.eye.set(position.x, position.y, position.z).applyMatrix4(this.player.matrixWorld);
    if (this.initial && !this.explicitHeight) this.targetHeight = Math.max(DEFAULT_HEIGHT, this.eye.y);
    const verticalScale = this.player.matrixWorld.elements[5];
    if (!Number.isFinite(this.eye.y) || verticalScale < .001) return false;
    const difference = (this.targetHeight - this.eye.y) / verticalScale;
    this.dirty = false; this.initial = false;
    if (Math.abs(difference) < .005) { this.onChange(this.targetHeight); return false; }
    this.offset += difference;
    this.manager.setReferenceSpace(this.base!.getOffsetReferenceSpace(this.transform(this.offset)));
    this.onChange(this.targetHeight); return true;
  }

  dispose() {
    this.base?.removeEventListener('reset', this.reset);
    if (this.base && this.manager.getSession() === this.session) this.manager.setReferenceSpace(this.base);
    this.base = null; this.session = null;
  }
}
