/** Quest opens its system keyboard when a DOM input receives focus. */
export function bindNativeInput(element: HTMLInputElement | HTMLTextAreaElement, change: (value: string) => void) {
  // UIKit's default input is -1000vw off screen. Keep it in the viewport so
  // Quest typing cannot scroll the page away when the immersive session ends.
  Object.assign(element.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  element.maxLength = 12000;
  element.enterKeyHint = 'done';
  element.setAttribute('aria-label', 'Talk or type');
  const sync = () => change(element.value);
  element.addEventListener('input', sync);
  element.addEventListener('change', sync);
  element.addEventListener('blur', sync);
  return {
    open() { element.focus({ preventScroll: true }); },
    sync,
    dispose() {
      element.removeEventListener('input', sync);
      element.removeEventListener('change', sync);
      element.removeEventListener('blur', sync);
      element.blur();
    },
  };
}
