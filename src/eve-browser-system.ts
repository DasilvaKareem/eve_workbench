import { CanvasTexture, createSystem, LinearFilter, PokeInteractable, Quaternion, RayInteractable, SRGBColorSpace, UIKitMLAsset, Vector3, VisibilityState, type UIKit } from '@iwsdk/core';
import { eve } from './eve-client.js';
import { browserWatch } from './eve-browser-watch.js';
import { createBrowserSurface } from './eve-browser-surface.js';
import { onSandboxBrowserVisibility, showSandboxBrowser } from './eve-browser-visibility.js';

/** A separate anchored screen; drawing happens only when a new frame arrives. */
export class EveBrowserSystem extends createSystem({}) {
  private panel: UIKitMLAsset | null = null;
  private open = false;
  private pendingPlacement = false;
  private side = true;
  private eye = new Vector3();
  private forward = new Vector3();
  private right = new Vector3();
  private up = new Vector3(0, 1, 0);
  private orientation = new Quaternion();

  init() {
    let disposed = false;
    this.cleanupFuncs.push(() => { disposed = true; });
    void this.world.assets.instantiate<UIKitMLAsset>('eve-browser').then(panel => {
      if (disposed) { panel.dispose(); return; }
      this.panel = panel; panel.visible = false;
      const entity = this.world.createTransformEntity(panel);
      entity.addComponent(RayInteractable); entity.addComponent(PokeInteractable);
      const image = panel.requireElementById<UIKit.Image>('eve-browser-screen');
      const status = panel.requireElementById<UIKit.Text>('eve-browser-status');
      const activity = panel.requireElementById<UIKit.Text>('eve-browser-activity');
      const canvas = document.createElement('canvas');
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace; texture.generateMipmaps = false;
      texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
      const surface = createBrowserSurface(canvas, () => { texture.needsUpdate = true; });
      image.setProperties({ src: texture });
      const sync = () => {
        const visible = this.world.visibilityState.peek() === VisibilityState.Visible && this.open;
        panel.visible = visible && !this.pendingPlacement;
        browserWatch.setActive('xr', visible);
      };
      const bind = (id: string, action: () => void) => {
        const button = panel.requireElementById(id);
        const enter = () => button.setProperties({ backgroundColor: '#425746' });
        const leave = () => button.setProperties({ backgroundColor: '#29352f' });
        const down = () => button.setProperties({ backgroundColor: '#60756a' });
        button.addEventListener('pointerenter', enter); button.addEventListener('pointerleave', leave);
        button.addEventListener('pointerdown', down); button.addEventListener('pointerup', enter);
        button.addEventListener('pointercancel', leave); button.addEventListener('click', action);
        this.cleanupFuncs.push(() => {
          button.removeEventListener('pointerenter', enter); button.removeEventListener('pointerleave', leave);
          button.removeEventListener('pointerdown', down); button.removeEventListener('pointerup', enter);
          button.removeEventListener('pointercancel', leave); button.removeEventListener('click', action);
        });
      };
      bind('eve-browser-place', () => { this.side = false; this.pendingPlacement = true; });
      bind('eve-browser-hide', () => showSandboxBrowser(false));
      bind('eve-browser-cancel', () => void eve.cancel());
      let autoOpened = false, session: string | null = null;
      const stopEve = eve.subscribe(state => {
        if (session !== state.sessionId) { session = state.sessionId; autoOpened = false; surface.update(null); showSandboxBrowser(false); }
        if (!autoOpened && state.browserActions.length) { autoOpened = true; this.side = true; showSandboxBrowser(); }
        activity.setProperties({ text: state.browserActions.slice(-3).map(action => `${action.tool} - ${action.status}`).join('\n') || 'Browser actions appear here as Eve works.' });
      });
      const stopWatch = browserWatch.subscribe(state => {
        status.setProperties({ text: `${state.message.replace(/’/g, "'").replace(/·/g, '-')}${state.url ? `\n${state.url.slice(0, 90)}` : ''}` });
        surface.update(state.frame);
      });
      const stopOpen = onSandboxBrowserVisibility(open => {
        if (open && !this.open) this.pendingPlacement = true;
        this.open = open; sync();
      });
      const stopVisibility = this.world.visibilityState.subscribe(value => {
        if (value === VisibilityState.Visible && this.open) this.pendingPlacement = true;
        sync();
      });
      this.cleanupFuncs.push(stopEve, stopWatch, stopOpen, stopVisibility, () => {
        browserWatch.setActive('xr', false); this.panel = null;
        surface.dispose(); image.setProperties({ src: undefined }); texture.dispose(); entity.dispose();
      });
    }).catch(error => console.error('Sandbox browser panel could not load:', error));
  }

  update() {
    if (!this.panel || !this.open || !this.pendingPlacement || this.world.visibilityState.peek() !== VisibilityState.Visible) return;
    const frame = this.xrManager.getFrame(), reference = this.xrManager.getReferenceSpace();
    if (!frame || !reference) return;
    const pose = frame.getViewerPose(reference);
    if (!pose) return;
    this.player.updateWorldMatrix(true, false);
    const position = pose.transform.position, rotation = pose.transform.orientation;
    this.eye.set(position.x, position.y, position.z).applyMatrix4(this.player.matrixWorld);
    this.orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.forward.set(0, 0, -1).applyQuaternion(this.orientation).transformDirection(this.player.matrixWorld);
    this.forward.y = 0;
    if (this.forward.lengthSq() < .001) this.forward.set(0, 0, -1); else this.forward.normalize();
    this.right.crossVectors(this.forward, this.up);
    this.panel.position.copy(this.eye).addScaledVector(this.forward, 1.4).addScaledVector(this.right, this.side ? -1.05 : 0);
    this.panel.position.y -= .12;
    this.panel.rotation.set(0, Math.atan2(this.eye.x - this.panel.position.x, this.eye.z - this.panel.position.z), 0);
    this.panel.scale.setScalar(.24); this.panel.visible = true; this.pendingPlacement = false;
  }
}
