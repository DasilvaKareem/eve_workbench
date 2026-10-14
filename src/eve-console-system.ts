import { createSystem, InputComponent, PokeInteractable, Quaternion, RayInteractable, UIKitMLAsset, Vector3, VisibilityState, type UIKit } from '@iwsdk/core';
import { eve } from './eve-client.ts';
import { paginatePanelText } from './eve-panel-content.ts';
import { eveVoice } from './eve-voice.ts';
import { bindNativeInput } from './eve-native-input.ts';
import { promptDraft } from './eve-prompt.ts';
import { bindPanelGestures } from './eve-panel-gestures.ts';

/** One prompt in XR. Quest system keyboard and dictation through a focused DOM text field. */
export class EveConsoleSystem extends createSystem({}) {
  private panel: UIKitMLAsset | null = null;
  private pendingPlacement = false;
  private handle: ReturnType<typeof bindPanelGestures> | null = null;
  private eye = new Vector3();
  private forward = new Vector3();
  private orientation = new Quaternion();

  init(): void {
    let disposed = false;
    const xrInput = this.world.input.xr;
    const previousGaze = xrInput.gazeEnabled;
    xrInput.gazeEnabled = false;
    this.cleanupFuncs.push(() => { xrInput.gazeEnabled = previousGaze; });
    this.cleanupFuncs.push(() => { disposed = true; });
    void this.world.assets.instantiate<UIKitMLAsset>('eve-console').then(panel => {
      if (disposed) { panel.dispose(); return; }
      const entity = this.world.createTransformEntity(panel);
      entity.addComponent(RayInteractable);
      entity.addComponent(PokeInteractable);
      this.panel = panel;
      panel.visible = false;
      const input = panel.requireElementById<UIKit.Textarea>('eve-xr-prompt');
      const status = panel.requireElementById<UIKit.Text>('eve-xr-status');
      const reply = panel.requireElementById('eve-xr-reply');
      const response = panel.requireElementById<UIKit.Text>('eve-xr-response');
      let page = 0, lastMessage = '';
      let pages = [''];
      const ready = () => ['ready', 'waiting'].includes(eve.state.phase);
      const nativeInput = bindNativeInput(input.element, value => promptDraft.set(value));
      input.setProperties({ onValueChange: (value: string) => promptDraft.set(value) });
      const onField = () => { if (ready()) nativeInput.open(); };
      input.addEventListener('click', onField);
      for (const eventName of ['keydown', 'keyup']) {
        const onKey = (raw: Event) => {
          const event = raw as KeyboardEvent;
          event.stopPropagation();
          if (eventName === 'keydown' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
        };
        input.element.addEventListener(eventName, onKey);
        this.cleanupFuncs.push(() => input.element.removeEventListener(eventName, onKey));
      }
      const paint: (() => void)[] = [];
      const bind = (id: string, action: () => void, enabled = () => true) => {
        const button = panel.requireElementById(id);
        const hovering = new Set<number>(), pressing = new Set<number>();
        const refresh = () => button.setProperties({
          backgroundColor: !enabled() ? '#263029' : pressing.size ? '#9db785' : hovering.size ? '#4f6749' : id === 'eve-xr-send' ? '#d6f29a' : '#304137',
          color: !enabled() ? '#73816f' : id === 'eve-xr-send' ? '#192519' : '#f5f5ee',
        });
        const enter = (event: { pointerId?: number }) => { hovering.add(event.pointerId ?? 0); refresh(); };
        const leave = (event: { pointerId?: number }) => { hovering.delete(event.pointerId ?? 0); pressing.delete(event.pointerId ?? 0); refresh(); };
        const down = (event: { pointerId?: number }) => { pressing.add(event.pointerId ?? 0); refresh(); };
        const up = (event: { pointerId?: number }) => { pressing.delete(event.pointerId ?? 0); refresh(); };
        const click = () => { if (enabled()) action(); refresh(); };
        const events = [['pointerenter', enter], ['pointerleave', leave], ['pointerdown', down], ['pointerup', up], ['pointercancel', leave], ['click', click]] as const;
        for (const [name, listener] of events) button.addEventListener(name, listener);
        this.cleanupFuncs.push(() => { for (const [name, listener] of events) button.removeEventListener(name, listener); });
        paint.push(refresh);
      };
      const showReply = () => {
        const latest = eve.state.messages[eve.state.messages.length - 1];
        const text = eve.state.error || (latest?.role === 'user' ? `You: ${latest.text}\n\n${eve.state.activity}` : latest?.text) || '';
        if (latest?.id !== lastMessage) { this.handle?.cancel(); lastMessage = latest?.id || ''; page = 0; }
        pages = paginatePanelText(text, 44, 7);
        page = Math.max(0, Math.min(page, pages.length - 1));
        reply.setProperties({ display: text ? 'flex' : 'none' });
        response.setProperties({ text: pages[page] });
        panel.requireElementById('eve-xr-pages').setProperties({ display: pages.length > 1 ? 'flex' : 'none' });
        panel.requireElementById<UIKit.Text>('eve-xr-page').setProperties({ text: `${page + 1} / ${pages.length}\nPinch + slide` });
      };
      const render = () => {
        input.setProperties({ disabled: !ready() });
        status.setProperties({ text: eve.state.phase === 'locked' ? 'Unlock in browser first' : eve.state.activity });
        panel.requireElementById<UIKit.Text>('eve-xr-send-label').setProperties({ text: eve.state.phase === 'working' ? 'Stop' : eve.state.phase === 'error' ? 'Retry' : 'Send' });
        showReply();
        for (const refresh of paint) refresh();
      };
      const send = () => {
        if (eve.state.phase === 'working') { void eve.cancel(); return; }
        if (eve.state.phase === 'error') { void eve.connect(); return; }
        nativeInput.sync();
        const text = promptDraft.text.trim();
        if (!ready() || !text) return;
        input.blur(); promptDraft.set('');
        void eve.send(text).then(() => { if (eve.state.phase === 'error' && !promptDraft.text) promptDraft.set(text); });
      };
      bind('eve-xr-send', send, () => ['working', 'error'].includes(eve.state.phase) || (ready() && Boolean(promptDraft.text.trim())));
      bind('eve-xr-mic', onField, ready);
      bind('eve-xr-exit', () => { void this.world.exitXR(); });
      bind('eve-xr-previous', () => { page--; render(); }, () => page > 0);
      bind('eve-xr-next-page', () => { page++; render(); }, () => page < pages.length - 1);
      const handle = bindPanelGestures({
        panel, handle: panel.requireElementById('eve-xr-handle'), hint: panel.requireElementById('eve-xr-gesture-hint'),
        minScale: .18, maxScale: .34,
        isActive: () => panel.visible && !this.pendingPlacement && this.world.visibilityState.peek() === VisibilityState.Visible,
        navigation: { surface: panel.requireElementById('eve-xr-page'),
          previous: () => { page--; render(); }, next: () => { page++; render(); },
          canPrevious: () => page > 0, canNext: () => page < pages.length - 1 },
      });
      this.handle = handle;
      this.cleanupFuncs.push(() => handle.dispose());
      const stopDraft = promptDraft.subscribe(text => { input.setProperties({ value: text }); render(); });
      const stopState = eve.subscribe(render);
      const stopVisibility = this.world.visibilityState.subscribe(value => {
        handle.cancel();
        if (value === VisibilityState.NonImmersive) { panel.visible = false; nativeInput.sync(); input.blur(); }
        else if (value === VisibilityState.Visible && !panel.visible) this.pendingPlacement = true;
      });
      this.cleanupFuncs.push(stopDraft, stopState, stopVisibility, () => {
        input.removeEventListener('click', onField); nativeInput.dispose(); this.panel = null; this.handle = null; entity.dispose();
      });
    }).catch(error => console.error('Eve prompt could not load:', error));
  }

  update(_delta: number, time: number): void {
    if (!this.panel || this.world.visibilityState.peek() !== VisibilityState.Visible) return;
    this.handle?.update(time * 1000);
    if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.Thumbstick)) { this.handle?.cancel(); this.pendingPlacement = true; }
    if (!this.pendingPlacement) return;
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
    this.panel.position.copy(this.eye).addScaledVector(this.forward, .85);
    this.panel.position.y -= .15;
    this.panel.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    this.panel.scale.setScalar(.24);
    this.panel.visible = true; this.pendingPlacement = false;
  }
}
