import { CanvasTexture, createSystem, InputComponent, LinearFilter, PokeInteractable, Quaternion, RayInteractable, SRGBColorSpace, UIKitMLAsset, Vector3, VisibilityState, type UIKit } from '@iwsdk/core';
import { eve } from './eve-client.js';
import { paginatePanelText } from './eve-panel-content.js';
import { taskListText, taskSnapshot } from './eve-task-charts.js';
import type { TaskChartSurface } from './eve-task-chart-surface.js';
import { showSandboxBrowser } from './eve-browser-visibility.js';

/** Code-owned console, independent of scene composition and the editor's assets. */
export class EveConsoleSystem extends createSystem({}) {
  private panel: UIKitMLAsset | null = null;
  private pendingPlacement = false;
  private near = false;
  private eyePosition = new Vector3();
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
      this.panel = panel;
      panel.visible = false;

      const status = panel.requireElementById<UIKit.Text>('eve-xr-status');
      const response = panel.requireElementById<UIKit.Text>('eve-xr-response');
      const pageLabel = panel.requireElementById<UIKit.Text>('eve-xr-page');
      const replyView = panel.requireElementById('eve-xr-reply-view');
      const chartView = panel.requireElementById('eve-xr-chart-view');
      const chartImage = panel.requireElementById<UIKit.Image>('eve-xr-task-chart');
      const chartSummary = panel.requireElementById<UIKit.Text>('eve-xr-chart-summary');
      let view: 'reply' | 'list' | 'map' | 'progress' = 'reply';
      let surface: TaskChartSurface | undefined;
      let texture: CanvasTexture | undefined;
      let chartLoading = false;
      let chartFailed = false;
      let replyText = 'Your conversation comes with you.';
      let pages = [''];
      let page = 0;
      let pageCount = 1;
      let lastText = '';
      let lastMessage = '';
      let headAim = false;
      const previousGaze = this.input.xr.gazeEnabled;
      // Quest 3's primary inputs are hands/controllers. Look-and-pinch is opt-in.
      this.input.xr.gazeEnabled = false;
      const refreshButtons: (() => void)[] = [];
      const refresh = () => { for (const update of refreshButtons) update(); };
      const loadChart = async () => {
        if (surface || chartLoading || chartFailed || disposed) return;
        chartLoading = true;
        chartSummary.setProperties({ text: 'Loading task chart...' });
        try {
          const { createTaskChartSurface } = await import('./eve-task-chart-surface.js');
          if (disposed) return;
          const canvas = document.createElement('canvas');
          surface = createTaskChartSurface(canvas, () => { if (texture) texture.needsUpdate = true; });
          texture = new CanvasTexture(canvas);
          texture.colorSpace = SRGBColorSpace;
          texture.generateMipmaps = false;
          texture.minFilter = LinearFilter;
          texture.magFilter = LinearFilter;
          chartImage.setProperties({ src: texture });
          showPage();
        } catch (error) {
          chartFailed = true;
          chartImage.setProperties({ display: 'none' });
          chartSummary.setProperties({ text: 'Chart unavailable. Use Read task list.' });
          console.error('Spatial task chart could not load:', error);
        } finally { chartLoading = false; }
      };
      const showPage = () => {
        const chart = view === 'map' || view === 'progress';
        replyView.setProperties({ display: chart ? 'none' : 'flex' });
        chartView.setProperties({ display: chart ? 'flex' : 'none' });
        if (view === 'map' || view === 'progress') {
          const snapshot = taskSnapshot(eve.state.tasks, page);
          pageCount = view === 'map' ? snapshot.pageCount : 1;
          page = view === 'map' ? snapshot.page : 0;
          if (surface) {
            chartImage.setProperties({ display: 'flex' });
            surface.update(eve.state.tasks, view, page);
            chartSummary.setProperties({ text: snapshot.summary });
          } else if (!chartFailed) void loadChart();
        } else {
          const text = view === 'list' ? taskListText(eve.state.tasks) : replyText;
          if (text !== lastText) { pages = paginatePanelText(text); lastText = text; }
          pageCount = pages.length;
          page = Math.max(0, Math.min(page, pageCount - 1));
          response.setProperties({ text: pages[page] });
        }
        pageLabel.setProperties({ text: `${view === 'list' ? 'Tasks · ' : ''}${page + 1} / ${pageCount}` });
        refresh();
      };
      const bind = (id: string, handler: () => void, enabled = () => true, selected = () => false) => {
        const button = panel.requireElementById(id);
        const hovering = new Set<number>();
        const pressing = new Set<number>();
        const paint = () => button.setProperties({
          backgroundColor: !enabled() ? '#1e2823' : pressing.size ? '#b8da86' : hovering.size ? '#425746' : selected() ? '#354735' : '#29352f',
          color: !enabled() ? '#748378' : pressing.size ? '#182117' : selected() ? '#d6f29a' : '#e1efd7',
          borderColor: enabled() && (hovering.size || selected()) ? '#d6f29a' : '#60756a',
        });
        const onEnter = (event: { pointerId?: number }) => { hovering.add(event.pointerId ?? 0); paint(); };
        const onLeave = (event: { pointerId?: number }) => { hovering.delete(event.pointerId ?? 0); pressing.delete(event.pointerId ?? 0); paint(); };
        const onDown = (event: { pointerId?: number }) => { pressing.add(event.pointerId ?? 0); paint(); };
        const onUp = (event: { pointerId?: number }) => { pressing.delete(event.pointerId ?? 0); paint(); };
        const onClick = () => { if (enabled()) handler(); paint(); };
        button.addEventListener('pointerenter', onEnter);
        button.addEventListener('pointerleave', onLeave);
        button.addEventListener('pointerdown', onDown);
        button.addEventListener('pointerup', onUp);
        button.addEventListener('pointercancel', onLeave);
        button.addEventListener('click', onClick);
        refreshButtons.push(paint);
        this.cleanupFuncs.push(() => {
          button.removeEventListener('pointerenter', onEnter);
          button.removeEventListener('pointerleave', onLeave);
          button.removeEventListener('pointerdown', onDown);
          button.removeEventListener('pointerup', onUp);
          button.removeEventListener('pointercancel', onLeave);
          button.removeEventListener('click', onClick);
        });
      };
      const canSend = () => ['ready', 'waiting'].includes(eve.state.phase);
      const selectView = (next: typeof view) => { view = next; page = 0; chartFailed = false; showPage(); };
      bind('eve-xr-view-reply', () => selectView('reply'), () => true, () => view === 'reply');
      bind('eve-xr-view-map', () => selectView('map'), () => true, () => view === 'map');
      bind('eve-xr-view-progress', () => selectView('progress'), () => true, () => view === 'progress');
      bind('eve-xr-plan', () => void eve.send('Help me plan my work. Ask me what I want to accomplish.'), canSend);
      bind('eve-xr-tasks', () => selectView('list'));
      bind('eve-xr-next', () => void eve.send('Based on our conversation and task board, suggest my next concrete step.'), canSend);
      bind('eve-xr-cancel', () => void eve.cancel(), () => ['working', 'waiting'].includes(eve.state.phase));
      bind('eve-xr-exit', () => { void this.world.exitXR(); });
      bind('eve-xr-browser', () => showSandboxBrowser());
      bind('eve-xr-previous', () => { page--; showPage(); }, () => page > 0);
      bind('eve-xr-next-page', () => { page++; showPage(); }, () => page < pageCount - 1);
      bind('eve-xr-range', () => {
        this.near = !this.near;
        panel.requireElementById<UIKit.Text>('eve-xr-range-label').setProperties({ text: this.near ? 'Reading distance' : 'Bring closer' });
        this.pendingPlacement = true;
      });
      bind('eve-xr-recenter', () => { this.pendingPlacement = true; });
      bind('eve-xr-aim', () => {
        headAim = !headAim;
        this.input.xr.gazeEnabled = headAim;
        panel.requireElementById<UIKit.Text>('eve-xr-aim-label').setProperties({ text: headAim ? 'Aim: Look' : 'Aim: Hands' });
        panel.requireElementById<UIKit.Text>('eve-xr-hint').setProperties({ text: headAim
          ? 'Look toward a button and pinch. Quest 3 uses head pointing. Touch still works.'
          : 'Touch a button, or point + trigger/pinch. Right stick click: recenter.' });
      });
      const stopState = eve.subscribe(state => {
        status.setProperties({ text: state.activity });
        const latest = [...state.messages].reverse().find(message => message.role === 'assistant');
        const text = state.error || latest?.text || 'Your conversation comes with you. Start a plan, check your tasks, or continue from the browser.';
        const message = state.error ? `error:${state.error}` : latest?.id || 'welcome';
        if (message !== lastMessage) { if (view === 'reply') page = 0; lastMessage = message; }
        replyText = text;
        showPage();
      });
      const stopVisibility = this.world.visibilityState.subscribe(value => {
        if (value === VisibilityState.NonImmersive) panel.visible = false;
        else this.pendingPlacement = true;
      });
      this.cleanupFuncs.push(stopState, stopVisibility, () => {
        this.input.xr.gazeEnabled = previousGaze;
        this.panel = null;
        surface?.dispose();
        chartImage.setProperties({ src: undefined });
        texture?.dispose();
        entity.dispose();
      });
    }).catch(error => { console.error('Eve spatial console could not load:', error); });
  }

  update(): void {
    if (!this.panel || this.world.visibilityState.peek() !== VisibilityState.Visible) return;
    if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.Thumbstick)) this.pendingPlacement = true;
    if (!this.pendingPlacement) return;
    const frame = this.xrManager.getFrame();
    const reference = this.xrManager.getReferenceSpace();
    if (!frame || !reference) return;
    const pose = frame.getViewerPose(reference);
    if (!pose) return;
    this.player.updateWorldMatrix(true, false);
    const position = pose.transform.position;
    const rotation = pose.transform.orientation;
    this.eyePosition.set(position.x, position.y, position.z).applyMatrix4(this.player.matrixWorld);
    this.orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.forward.set(0, 0, -1).applyQuaternion(this.orientation).transformDirection(this.player.matrixWorld);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 0.001) this.forward.set(0, 0, -1);
    else this.forward.normalize();
    const distance = this.near ? 0.65 : 1.1;
    this.panel.position.copy(this.eyePosition).addScaledVector(this.forward, distance);
    this.panel.position.y -= this.near ? 0.12 : 0.16;
    this.panel.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    this.panel.scale.setScalar(this.near ? 0.14 : 0.2);
    this.panel.visible = true;
    this.pendingPlacement = false;
  }
}
