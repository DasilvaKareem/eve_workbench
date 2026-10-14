import { HandleStore } from '@pmndrs/handle';
import { createSystem, InputComponent, PokeInteractable, Quaternion, RayInteractable, UIKitMLAsset, Vector3, VisibilityState, type UIKit } from '@iwsdk/core';
import { eve } from './eve-client.ts';
import { paginatePanelText } from './eve-panel-content.ts';
import { eveVoice } from './eve-voice.ts';
import { dictation } from './eve-dictation.ts';
import { promptDraft } from './eve-prompt.ts';

/** One prompt in XR. Native text input plus an in-world keyboard for headset browsers. */
export class EveConsoleSystem extends createSystem({}) {
  private panel: UIKitMLAsset | null = null;
  private pendingPlacement = false;
  private handle: HandleStore<unknown> | null = null;
  private eye = new Vector3();
  private forward = new Vector3();
  private orientation = new Quaternion();

  init(): void {
    let disposed = false;
    this.cleanupFuncs.push(() => { disposed = true; });
    void this.world.assets.instantiate<UIKitMLAsset>('eve-console').then(panel => {
      if (disposed) { panel.dispose(); return; }
      const entity = this.world.createTransformEntity(panel);
      entity.addComponent(RayInteractable);
      entity.addComponent(PokeInteractable);
      // Bind manipulation only to the title handle. Putting a grabbable on the
      // entire UI root denies ray input to its text fields and buttons.
      const handle = new HandleStore(panel, () => ({
        multitouch: true, translate: true, rotate: true,
        scale: { uniform: true, x: [.16, .4], y: [.16, .4], z: [.16, .4] },
      }));
      this.handle = handle;
      const unbindHandle = handle.bind(panel.requireElementById('eve-xr-handle'));
      this.cleanupFuncs.push(unbindHandle);
      this.panel = panel;
      panel.visible = false;
      const input = panel.requireElementById<UIKit.Textarea>('eve-xr-prompt');
      const keyboard = panel.requireElementById('eve-xr-keyboard');
      const status = panel.requireElementById<UIKit.Text>('eve-xr-status');
      const reply = panel.requireElementById('eve-xr-reply');
      const response = panel.requireElementById<UIKit.Text>('eve-xr-response');
      let typing = false, uppercase = false, page = 0, lastMessage = '';
      let pages = [''];
      const ready = () => ['ready', 'waiting'].includes(eve.state.phase);
      const busyVoice = () => ['preparing', 'recording', 'transcribing'].includes(dictation.state.phase);
      const setTyping = (value: boolean) => {
        typing = value;
        keyboard.setProperties({ display: value ? 'flex' : 'none' });
      };
      input.setProperties({ onValueChange: (value: string) => promptDraft.set(value) });
      // A browser keyboard is not guaranteed in immersive mode. This opens a real
      // ray/poke keyboard inside the same panel and also allows physical keyboards.
      const onField = () => { if (ready() && !busyVoice()) setTyping(true); };
      input.addEventListener('click', onField);
      input.element.maxLength = 12000;
      input.element.setAttribute('aria-label', 'Talk or type');
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
        let hover = false, pressed = false;
        const refresh = () => button.setProperties({
          backgroundColor: !enabled() ? '#263029' : pressed ? '#9db785' : hover ? '#4f6749' : id === 'eve-xr-send' ? '#d6f29a' : '#304137',
          color: !enabled() ? '#73816f' : id === 'eve-xr-send' ? '#192519' : '#f5f5ee',
        });
        const enter = () => { hover = true; refresh(); };
        const leave = () => { hover = false; pressed = false; refresh(); };
        const down = () => { pressed = true; refresh(); };
        const up = () => { pressed = false; refresh(); };
        const click = () => { if (enabled()) action(); refresh(); };
        const events = [['pointerenter', enter], ['pointerleave', leave], ['pointerdown', down], ['pointerup', up], ['pointercancel', leave], ['click', click]] as const;
        for (const [name, listener] of events) button.addEventListener(name, listener);
        this.cleanupFuncs.push(() => { for (const [name, listener] of events) button.removeEventListener(name, listener); });
        paint.push(refresh);
      };
      const showReply = () => {
        const latest = [...eve.state.messages].reverse().find(message => message.role === 'assistant');
        const text = eve.state.error || latest?.text || '';
        if (latest?.id !== lastMessage) { lastMessage = latest?.id || ''; page = 0; }
        pages = paginatePanelText(text, 44, 7);
        page = Math.max(0, Math.min(page, pages.length - 1));
        reply.setProperties({ display: text ? 'flex' : 'none' });
        response.setProperties({ text: pages[page] });
        panel.requireElementById('eve-xr-pages').setProperties({ display: pages.length > 1 ? 'flex' : 'none' });
        panel.requireElementById<UIKit.Text>('eve-xr-page').setProperties({ text: `${page + 1} / ${pages.length}` });
      };
      const render = () => {
        const voice = dictation.state;
        input.setProperties({ disabled: !ready() || busyVoice() });
        status.setProperties({ text: voice.error || (voice.phase === 'recording' ? 'Listening...'
          : voice.phase === 'transcribing' ? 'Transcribing...'
          : voice.phase === 'preparing' ? 'Allow microphone...'
          : eve.state.phase === 'locked' ? 'Unlock in browser first' : eve.state.activity) });
        panel.requireElementById<UIKit.Text>('eve-xr-mic-label').setProperties({ text: voice.phase === 'recording' ? 'Stop mic' : 'Talk' });
        panel.requireElementById<UIKit.Text>('eve-xr-send-label').setProperties({ text: eve.state.phase === 'working' ? 'Stop' : 'Send' });
        if (!ready() || busyVoice()) setTyping(false);
        showReply();
        for (const refresh of paint) refresh();
      };
      const send = () => {
        if (eve.state.phase === 'working') { void eve.cancel(); return; }
        const text = promptDraft.text.trim();
        if (!ready() || busyVoice() || !text) return;
        setTyping(false); input.blur(); promptDraft.set(''); dictation.cancel(); void eve.send(text);
      };
      bind('eve-xr-send', send, () => eve.state.phase === 'working' || (ready() && !busyVoice() && Boolean(promptDraft.text.trim())));
      bind('eve-xr-mic', () => {
        setTyping(false); input.blur();
        if (dictation.state.phase === 'recording') dictation.stop();
        else { eveVoice.stop(); void dictation.start(); }
      }, () => dictation.state.phase === 'recording' || (ready() && dictation.state.supported && !busyVoice()));
      bind('eve-xr-exit', () => { void this.world.exitXR(); });
      bind('eve-xr-previous', () => { page--; render(); }, () => page > 0);
      bind('eve-xr-next-page', () => { page++; render(); }, () => page < pages.length - 1);
      const rows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm,.?'];
      for (const [i, row] of rows.entries()) for (const [j, key] of Array.from(row).entries()) {
        bind(`eve-key-${i}-${j}`, () => promptDraft.insert(uppercase ? key.toUpperCase() : key), () => ready() && typing);
      }
      bind('eve-key-space', () => promptDraft.insert(' '));
      bind('eve-key-backspace', () => promptDraft.backspace());
      bind('eve-key-done', () => { setTyping(false); input.blur(); });
      bind('eve-key-shift', () => {
        uppercase = !uppercase;
        for (const [i, row] of rows.entries()) for (const [j, key] of Array.from(row).entries()) {
          panel.requireElementById<UIKit.Text>(`eve-key-${i}-${j}`).setProperties({ text: uppercase ? key.toUpperCase() : key });
        }
      });
      const stopDraft = promptDraft.subscribe(text => { input.setProperties({ value: text }); render(); });
      const stopState = eve.subscribe(render);
      const stopVoice = dictation.subscribe(render);
      const stopVisibility = this.world.visibilityState.subscribe(value => {
        if (value === VisibilityState.NonImmersive) { panel.visible = false; setTyping(false); input.blur(); }
        else if (value === VisibilityState.Visible && !panel.visible) this.pendingPlacement = true;
        if (value !== VisibilityState.Visible && dictation.state.phase === 'recording') dictation.cancel();
      });
      this.cleanupFuncs.push(stopDraft, stopState, stopVoice, stopVisibility, () => {
        input.removeEventListener('click', onField); dictation.cancel(); this.panel = null; this.handle = null; entity.dispose();
      });
    }).catch(error => console.error('Eve prompt could not load:', error));
  }

  update(_delta: number, time: number): void {
    if (!this.panel || this.world.visibilityState.peek() !== VisibilityState.Visible) return;
    this.handle?.update(time * 1000);
    if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.Thumbstick)) this.pendingPlacement = true;
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
