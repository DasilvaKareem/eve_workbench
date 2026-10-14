import { createSystem, InputComponent, PokeInteractable, Quaternion, RayInteractable, UIKitMLAsset, Vector3, VisibilityState, type UIKit } from '@iwsdk/core';
import { EveFloatingWindow } from './eve-window-component.ts';
import { workspaceWindows } from './eve-windows.ts';
import { mountSpatialChat } from './eve-spatial-chat.ts';
import { mountSpatialIntegrations } from './eve-spatial-integrations.ts';
import { bindPanelGestures } from './eve-panel-gestures.ts';

type WindowView = {
  panel: UIKitMLAsset; handle: ReturnType<typeof bindPanelGestures>; pendingPlacement: boolean; slot: number;
  refresh: () => void; dispose: () => void;
};

/** Independent world-space surfaces. ECS entities own their lifetime and interaction components. */
export class EveWindowSystem extends createSystem({ windows: { required: [EveFloatingWindow] } }) {
  private views = new Map<string, WindowView>();
  private loading = new Set<string>();
  private eye = new Vector3();
  private forward = new Vector3();
  private direction = new Vector3();
  private orientation = new Quaternion();

  init(): void {
    let disposed = false;
    const reconcile = () => {
      const ids = new Set(workspaceWindows.entries.map(entry => entry.id));
      for (const entity of this.queries.windows.entities) {
        const id = entity.getValue(EveFloatingWindow, 'windowId') || '';
        if (!ids.has(id)) { this.views.get(id)?.dispose(); this.views.delete(id); entity.dispose(); }
      }
      for (const entry of workspaceWindows.entries) {
        const view = this.views.get(entry.id);
        if (view) { view.refresh(); continue; }
        if (this.loading.has(entry.id)) continue;
        this.loading.add(entry.id);
        void this.world.assets.instantiate<UIKitMLAsset>('eve-window').then(panel => {
          this.loading.delete(entry.id);
          if (disposed || !workspaceWindows.entries.some(item => item.id === entry.id)) { panel.dispose(); return; }
          const entity = this.world.createTransformEntity(panel);
          entity.addComponent(EveFloatingWindow, { windowId: entry.id });
          entity.addComponent(RayInteractable); entity.addComponent(PokeInteractable);
          panel.visible = false;
          const viewport = panel.requireElementById<UIKit.Container>('window-content');
          const chat = entry.kind === 'integrations' ? mountSpatialIntegrations(viewport, url => {
            void Promise.resolve(this.world.exitXR()).then(() => { window.location.assign(url); });
          }) : mountSpatialChat(viewport, () => {
            const current = workspaceWindows.entries.find(item => item.id === entry.id);
            return current?.panel ? [{ id: `panel:${current.panel.id}`, role: 'panel', text: current.panel.title, panel: current.panel }]
              : [{ id: 'empty', role: 'assistant', text: 'Ask Eve in Talk or type what to put in this window: a graph, tasks, notes, or a table.' }];
          }, false);
          const stops: (() => void)[] = [];
          const bind = (id: string, action: () => void) => {
            const button = panel.requireElementById(id);
            button.addEventListener('click', action); stops.push(() => button.removeEventListener('click', action));
          };
          bind('window-close', () => workspaceWindows.close(entry.id));
          bind('window-older', () => chat.scroll(-150)); bind('window-newer', () => chat.scroll(150));
          const handle = bindPanelGestures({ panel, handle: panel.requireElementById('window-handle'), hint: panel.requireElementById('window-hint'),
            minScale: .16, maxScale: .4, isActive: () => panel.visible && !view.pendingPlacement && this.world.visibilityState.peek() === VisibilityState.Visible });
          let slot = 0; while ([...this.views.values()].some(item => item.slot === slot)) slot++;
          const view: WindowView = { panel, handle, pendingPlacement: true, slot,
            refresh: () => {
              const current = workspaceWindows.entries.find(item => item.id === entry.id);
              panel.requireElementById('window-title').setProperties({ text: current?.kind === 'integrations' ? 'Eve integrations' : current?.panel?.title || 'New window' });
              panel.requireElementById('window-context-hint').setProperties({ text: current?.kind === 'integrations' ? 'Choose an app to connect' : 'Ask Eve below to fill this window' }); chat.refresh();
            },
            dispose: () => { handle.dispose(); chat.dispose(); for (const stop of stops) stop(); },
          };
          this.views.set(entry.id, view); view.refresh();
        }).catch(error => { this.loading.delete(entry.id); console.error('Floating window could not load:', error); });
      }
    };
    const stopWindows = workspaceWindows.subscribe(reconcile);
    const stopVisibility = this.world.visibilityState.subscribe(value => {
      for (const view of this.views.values()) {
        view.handle.cancel();
        if (value === VisibilityState.NonImmersive) view.panel.visible = false;
        else if (value === VisibilityState.Visible && !view.panel.visible) view.pendingPlacement = true;
      }
    });
    this.cleanupFuncs.push(() => {
      disposed = true; stopWindows(); stopVisibility();
      for (const view of this.views.values()) view.dispose(); this.views.clear();
      for (const entity of this.queries.windows.entities) entity.dispose();
    });
  }

  update(_delta: number, time: number): void {
    if (this.world.visibilityState.peek() !== VisibilityState.Visible) return;
    const recenter = this.input.xr.gamepads.right?.getButtonDown(InputComponent.Thumbstick);
    const frame = this.xrManager.getFrame(), reference = this.xrManager.getReferenceSpace();
    const pose = frame && reference ? frame.getViewerPose(reference) : null;
    for (const entity of this.queries.windows.entities) {
      const view = this.views.get(entity.getValue(EveFloatingWindow, 'windowId') || ''); if (!view) continue;
      view.handle.update(time * 1000);
      if (recenter) { view.handle.cancel(); view.pendingPlacement = true; }
      if (!view.pendingPlacement || !pose) continue;
      this.player.updateWorldMatrix(true, false);
      const position = pose.transform.position, rotation = pose.transform.orientation;
      this.eye.set(position.x, position.y, position.z).applyMatrix4(this.player.matrixWorld);
      this.orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this.forward.set(0, 0, -1).applyQuaternion(this.orientation).transformDirection(this.player.matrixWorld); this.forward.y = 0;
      if (this.forward.lengthSq() < .001) this.forward.set(0, 0, -1); else this.forward.normalize();
      const isIntegrations = entity.getValue(EveFloatingWindow, 'windowId') === 'eve-integrations';
      const angle = isIntegrations ? .9 : (view.slot % 2 ? -1 : 1) * (Math.floor(view.slot / 2) + 1) * .73;
      this.direction.set(this.forward.x * Math.cos(angle) + this.forward.z * Math.sin(angle), 0,
        this.forward.z * Math.cos(angle) - this.forward.x * Math.sin(angle));
      view.panel.position.copy(this.eye).addScaledVector(this.direction, isIntegrations ? 1 : 1.3); view.panel.position.y -= .1;
      view.panel.rotation.set(0, Math.atan2(-this.direction.x, -this.direction.z), 0); view.panel.scale.setScalar(.24);
      view.panel.visible = true; view.pendingPlacement = false;
    }
  }
}
