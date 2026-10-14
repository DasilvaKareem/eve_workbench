import { CanvasTexture, createSystem, LinearFilter, PokeInteractable, Quaternion, RayInteractable, SRGBColorSpace, UIKitMLAsset, Vector3, VisibilityState, type UIKit } from '@iwsdk/core';
import { eve } from './eve-client.js';
import { generatedPanelPages, type GeneratedPage } from './eve-generated-content.js';
import { onGeneratedPanelsVisibility, showGeneratedPanels } from './eve-generated-visibility.js';
import type { createGeneratedChartSurface } from './eve-task-chart-surface.js';

/** A bounded native panel template populated from validated model-authored blocks. */
export class EveGeneratedSystem extends createSystem({}) {
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
    void this.world.assets.instantiate<UIKitMLAsset>('eve-generated').then(panel => {
      if (disposed) { panel.dispose(); return; }
      this.panel = panel; panel.visible = false;
      const entity = this.world.createTransformEntity(panel);
      entity.addComponent(RayInteractable); entity.addComponent(PokeInteractable);
      const title = panel.requireElementById<UIKit.Text>('eve-generated-title');
      const text = panel.requireElementById<UIKit.Text>('eve-generated-text');
      const image = panel.requireElementById<UIKit.Image>('eve-generated-chart');
      const status = panel.requireElementById<UIKit.Text>('eve-generated-status');
      const pageLabel = panel.requireElementById<UIKit.Text>('eve-generated-page');
      let selected = '', key = '', page = 0;
      let pages: GeneratedPage[] = [{ text: 'Ask Eve to show a comparison, dashboard, or chart.' }];
      let surface: ReturnType<typeof createGeneratedChartSurface> | undefined;
      let texture: CanvasTexture | undefined;
      let loading = false, failed = false;
      const paints: (() => void)[] = [];
      const current = () => eve.state.panels.find(item => item.id === selected);
      const canSend = () => ['ready', 'waiting'].includes(eve.state.phase);
      const syncVisibility = () => { panel.visible = this.open && !this.pendingPlacement && this.world.visibilityState.peek() === VisibilityState.Visible; };
      const loadChart = async () => {
        if (surface || loading || failed) return;
        loading = true;
        try {
          const { createGeneratedChartSurface } = await import('./eve-task-chart-surface.js');
          if (disposed) return;
          const canvas = document.createElement('canvas');
          surface = createGeneratedChartSurface(canvas, () => { if (texture) texture.needsUpdate = true; });
          texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
          texture.generateMipmaps = false; texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
          image.setProperties({ src: texture });
          render();
        } catch (error) { failed = true; console.error('Generated panel chart unavailable:', error); render(); }
        finally { loading = false; }
      };
      const render = () => {
        const selectedPanel = current();
        page = Math.max(0, Math.min(page, pages.length - 1));
        const item = pages[page];
        const chart = Boolean(item.chart && !failed);
        title.setProperties({ text: selectedPanel?.title || 'Eve panels' });
        text.setProperties({ display: chart ? 'none' : 'flex', text: item.text });
        image.setProperties({ display: chart ? 'flex' : 'none' });
        status.setProperties({ text: item.chart ? failed ? 'Chart unavailable. Next page has complete data.' : surface ? 'Next page: complete chart data.' : 'Loading chart...' : `${eve.state.panels.length} panels - buttons send a follow-up message.` });
        if (item.chart && chart && this.open && this.world.visibilityState.peek() === VisibilityState.Visible) {
          if (surface) surface.update(item.chart); else void loadChart();
        }
        pageLabel.setProperties({ text: `${page + 1} / ${pages.length}` });
        panel.requireElementById('eve-generated-actions').setProperties({ display: selectedPanel?.actions.length ? 'flex' : 'none' });
        for (let index = 0; index < 3; index++) {
          const action = selectedPanel?.actions[index];
          panel.requireElementById(`eve-generated-action-${index}`).setProperties({ display: action ? 'flex' : 'none' });
          panel.requireElementById<UIKit.Text>(`eve-generated-action-label-${index}`).setProperties({ text: action?.label || '' });
        }
        for (const paint of paints) paint();
      };
      const bind = (id: string, handler: () => void, enabled = () => true) => {
        const button = panel.requireElementById(id);
        const paint = () => button.setProperties({ backgroundColor: '#29352f', color: enabled() ? '#e1efd7' : '#748378' });
        const enter = () => { if (enabled()) button.setProperties({ backgroundColor: '#425746' }); };
        const down = () => { if (enabled()) button.setProperties({ backgroundColor: '#60756a' }); };
        const click = () => { if (enabled()) handler(); };
        button.addEventListener('pointerenter', enter); button.addEventListener('pointerleave', paint);
        button.addEventListener('pointerdown', down); button.addEventListener('pointerup', enter);
        button.addEventListener('pointercancel', paint); button.addEventListener('click', click); paints.push(paint);
        this.cleanupFuncs.push(() => {
          button.removeEventListener('pointerenter', enter); button.removeEventListener('pointerleave', paint);
          button.removeEventListener('pointerdown', down); button.removeEventListener('pointerup', enter);
          button.removeEventListener('pointercancel', paint); button.removeEventListener('click', click);
        });
      };
      const selectPanel = (offset: number) => {
        const panels = eve.state.panels;
        if (!panels.length) return;
        const index = Math.max(0, panels.findIndex(item => item.id === selected));
        selected = panels[(index + offset + panels.length) % panels.length].id;
        pages = generatedPanelPages(current()!); page = 0; render();
      };
      bind('eve-generated-previous', () => { page--; render(); }, () => page > 0);
      bind('eve-generated-next', () => { page++; render(); }, () => page < pages.length - 1);
      bind('eve-generated-panel-previous', () => selectPanel(-1), () => eve.state.panels.length > 1);
      bind('eve-generated-panel-next', () => selectPanel(1), () => eve.state.panels.length > 1);
      bind('eve-generated-place', () => { this.side = false; this.pendingPlacement = true; });
      bind('eve-generated-hide', () => showGeneratedPanels(false));
      for (let index = 0; index < 3; index++) bind(`eve-generated-action-${index}`, () => {
        const action = current()?.actions[index]; if (action) void eve.send(action.prompt);
      }, () => Boolean(current()?.actions[index]) && canSend());
      const stopState = eve.subscribe(state => {
        const next = JSON.stringify(state.panels);
        if (next !== key) {
          key = next;
          const latest = state.panels.slice(-1)[0]?.id || '';
          if (selected !== latest) page = 0;
          selected = latest;
          pages = current() ? generatedPanelPages(current()!) : [{ text: 'Ask Eve to show a comparison, dashboard, or chart.' }];
          page = Math.min(page, pages.length - 1);
          if (state.panels.length) showGeneratedPanels();
          else showGeneratedPanels(false);
        }
        render();
      });
      const stopOpen = onGeneratedPanelsVisibility(open => {
        if (open && !this.open) this.pendingPlacement = true;
        this.open = open; syncVisibility(); render();
      });
      const stopVisibility = this.world.visibilityState.subscribe(value => {
        if (value === VisibilityState.Visible && this.open) this.pendingPlacement = true;
        syncVisibility(); render();
      });
      this.cleanupFuncs.push(stopState, stopOpen, stopVisibility, () => {
        this.panel = null; surface?.dispose(); image.setProperties({ src: undefined }); texture?.dispose(); entity.dispose();
      });
    }).catch(error => console.error('Generated panels could not load:', error));
  }

  update() {
    if (!this.panel || !this.open || !this.pendingPlacement || this.world.visibilityState.peek() !== VisibilityState.Visible) return;
    const frame = this.xrManager.getFrame(), reference = this.xrManager.getReferenceSpace();
    if (!frame || !reference) return;
    const pose = frame.getViewerPose(reference); if (!pose) return;
    this.player.updateWorldMatrix(true, false);
    const position = pose.transform.position, rotation = pose.transform.orientation;
    this.eye.set(position.x, position.y, position.z).applyMatrix4(this.player.matrixWorld);
    this.orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.forward.set(0, 0, -1).applyQuaternion(this.orientation).transformDirection(this.player.matrixWorld);
    this.forward.y = 0;
    if (this.forward.lengthSq() < .001) this.forward.set(0, 0, -1); else this.forward.normalize();
    this.right.crossVectors(this.forward, this.up);
    this.panel.position.copy(this.eye).addScaledVector(this.forward, 1.35).addScaledVector(this.right, this.side ? .95 : 0);
    this.panel.position.y -= .12;
    this.panel.rotation.set(0, Math.atan2(this.eye.x - this.panel.position.x, this.eye.z - this.panel.position.z), 0);
    this.panel.scale.setScalar(.22); this.panel.visible = true; this.pendingPlacement = false;
  }
}
