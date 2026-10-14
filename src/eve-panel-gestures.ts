import { HandleStore, type HandleOptions } from '@pmndrs/handle';
import { Quaternion, Vector3, type UIKitMLAsset } from '@iwsdk/core';
import { PanelSwipe } from './eve-panel-swipe.ts';

type Surface = ReturnType<UIKitMLAsset['requireElementById']>;
interface GestureEvent {
  pointerId: number; button?: number; timeStamp: number;
  point: Vector3; pointOnFace?: Vector3;
  stopPropagation(): void;
}
interface Options {
  panel: UIKitMLAsset;
  handle: Surface;
  hint: Surface;
  minScale: number;
  maxScale: number;
  isActive: () => boolean;
  navigation?: { surface: Surface; previous: () => void; next: () => void; canPrevious: () => boolean; canNext: () => boolean };
}

/** SDK pointer capture and the installed handle library keep selection, drag, and resizing in one input pipeline. */
export function bindPanelGestures(options: Options) {
  const { panel, handle, hint, navigation } = options;
  const origin = new Vector3(), right = new Vector3(), up = new Vector3(), delta = new Vector3(), anchor = new Vector3(), rotation = new Quaternion();
  const swipe = new PanelSwipe();
  let capturedSwipe = -1, message = '';
  const point = (event: GestureEvent) => event.pointOnFace || event.point;
  const valid = (event: GestureEvent) => options.isActive() && (event.button === undefined || event.button === 0)
    && Number.isFinite(point(event).x + point(event).y + point(event).z);
  const say = (text: string) => { if (text !== message) { message = text; hint.setProperties({ text }); } };
  const idle = () => say('Thumb + index: pinch title to move / Two hands: resize');
  const handleOptions: HandleOptions<unknown> = {
    multitouch: true, translate: true, rotate: false,
    scale: { uniform: true, x: [options.minScale, options.maxScale], y: [options.minScale, options.maxScale], z: [options.minScale, options.maxScale] },
    apply: (state, target) => {
      const value = state.current;
      if (!Number.isFinite(value.position.x + value.position.y + value.position.z + value.quaternion.x
        + value.quaternion.y + value.quaternion.z + value.quaternion.w + value.scale.x)) return;
      const size = Math.max(options.minScale, Math.min(options.maxScale, value.scale.x));
      // Handle 6.6 skips per-axis constraints for uniform scale. Clamp here and
      // preserve the two-pinched midpoint so reaching a size limit cannot push the panel away.
      if (store.inputState.size === 2 && size !== value.scale.x && value.scale.x > 1e-6) {
        anchor.set(0, 0, 0);
        for (const data of store.inputState.values()) anchor.add(data.pointerWorldPoint);
        anchor.multiplyScalar(.5);
        if (target.parent) target.parent.worldToLocal(anchor);
        value.position.sub(anchor).multiplyScalar(size / value.scale.x).add(anchor);
      }
      value.scale.setScalar(size);
      target.position.copy(value.position); target.quaternion.copy(value.quaternion); target.scale.copy(value.scale);
    },
    filter: event => {
      if (!valid(event) || store.inputState.size >= 2) return false;
      // Separate two intended pinches from coincident pointers or a tracking glitch.
      for (const data of store.inputState.values()) if (data.pointerWorldPoint.distanceTo(event.point) < .08) return false;
      return true;
    },
  };
  const store = new HandleStore(panel, () => handleOptions);
  const unbind = store.bind(handle);
  const cancelSwipe = () => {
    const id = capturedSwipe; capturedSwipe = -1; swipe.cancel();
    if (navigation) {
      if (id !== -1 && navigation.surface.hasPointerCapture(id)) navigation.surface.releasePointerCapture(id);
      navigation.surface.setProperties({ backgroundColor: '#25332e' });
    }
  };
  const cancel = () => {
    store.cancel(); cancelSwipe();
    handle.setProperties({ backgroundColor: '#25332e', borderColor: '#60756a' }); idle();
  };
  const feedback = () => {
    const count = store.inputState.size;
    if (count) {
      cancelSwipe(); handle.setProperties({ backgroundColor: '#425746', borderColor: '#d6f29a' });
      say(count > 1 ? 'Spread or close both pinches - release to finish' : 'Move your pinch - release to place');
    } else { handle.setProperties({ backgroundColor: '#25332e', borderColor: '#60756a' }); idle(); }
  };
  const enter = () => { if (!store.inputState.size) handle.setProperties({ backgroundColor: '#354735', borderColor: '#d6f29a' }); };
  const leave = () => { if (!store.inputState.size) handle.setProperties({ backgroundColor: '#25332e', borderColor: '#60756a' }); };
  const onCancel = () => cancel();
  handle.addEventListener('pointerdown', feedback); handle.addEventListener('pointerup', feedback);
  handle.addEventListener('pointercancel', onCancel);
  handle.addEventListener('pointerenter', enter); handle.addEventListener('pointerleave', leave);
  const swipeDown = (event: GestureEvent) => {
    if (!navigation || store.inputState.size || swipe.pointerId !== -1 || !valid(event)) return;
    if (!navigation.canNext() && !navigation.canPrevious()) return;
    panel.getWorldQuaternion(rotation);
    right.set(1, 0, 0).applyQuaternion(rotation); up.set(0, 1, 0).applyQuaternion(rotation);
    origin.copy(point(event));
    if (!swipe.begin(event.pointerId, 0, 0, event.timeStamp)) return;
    capturedSwipe = event.pointerId; navigation.surface.setPointerCapture(event.pointerId); event.stopPropagation();
    navigation.surface.setProperties({ backgroundColor: '#425746' });
    say('Slide left for next, right for previous');
  };
  const swipeEnd = (event: GestureEvent) => {
    if (!navigation || event.pointerId !== swipe.pointerId) return;
    event.stopPropagation(); delta.copy(point(event)).sub(origin);
    const direction = valid(event) ? swipe.end(event.pointerId, delta.dot(right), delta.dot(up), event.timeStamp) : 0;
    cancelSwipe(); idle();
    if (direction === 1 && navigation.canNext()) navigation.next();
    else if (direction === -1 && navigation.canPrevious()) navigation.previous();
  };
  navigation?.surface.addEventListener('pointerdown', swipeDown);
  navigation?.surface.addEventListener('pointerup', swipeEnd);
  navigation?.surface.addEventListener('pointercancel', onCancel);
  idle();
  return {
    update(timeMs: number) { if (options.isActive()) store.update(timeMs); else if (store.inputState.size || capturedSwipe !== -1) cancel(); },
    cancel,
    dispose() {
      cancel(); unbind();
      handle.removeEventListener('pointerdown', feedback); handle.removeEventListener('pointerup', feedback);
      handle.removeEventListener('pointercancel', onCancel);
      handle.removeEventListener('pointerenter', enter); handle.removeEventListener('pointerleave', leave);
      navigation?.surface.removeEventListener('pointerdown', swipeDown);
      navigation?.surface.removeEventListener('pointerup', swipeEnd);
      navigation?.surface.removeEventListener('pointercancel', onCancel);
    },
  };
}
