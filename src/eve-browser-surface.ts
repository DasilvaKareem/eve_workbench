import type { BrowserFrame } from './eve-browser-watch.js';

/** Decode only new frames, discard late decodes, preserve the browser's aspect ratio. */
export function createBrowserSurface(canvas: HTMLCanvasElement, onDraw = () => {}) {
  canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d')!;
  let key = '', generation = 0;
  const clear = () => {
    context.fillStyle = '#101918'; context.fillRect(0, 0, canvas.width, canvas.height); onDraw();
  };
  clear();
  return {
    update(frame: BrowserFrame | null) {
      const next = frame ? `${frame.seq}:${frame.receivedAt}` : '';
      if (next === key) return;
      key = next; const current = ++generation;
      if (!frame) { clear(); return; }
      const image = new Image();
      image.onload = () => {
        if (current !== generation) return;
        clear();
        const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height); onDraw();
      };
      image.src = `data:image/jpeg;base64,${frame.data}`;
    },
    dispose() { generation++; key = ''; clear(); },
  };
}
