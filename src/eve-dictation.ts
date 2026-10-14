export type DictationPhase = 'idle' | 'preparing' | 'recording' | 'transcribing' | 'review' | 'error';
export interface DictationState { phase: DictationPhase; draft: string; error: string | null; micReady: boolean; supported: boolean }
type Recorder = Pick<MediaRecorder, 'state' | 'mimeType' | 'ondataavailable' | 'onstop' | 'onerror' | 'start' | 'stop'>;
interface Dependencies {
  supported: boolean;
  capture: () => Promise<MediaStream>;
  recorder: (stream: MediaStream) => Recorder;
  transcribe: (audio: Blob, durationMs: number, signal: AbortSignal) => Promise<string>;
}

async function upload(audio: Blob, durationMs: number, signal: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const response = await globalThis.fetch('/api/eve/transcribe', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: btoa(binary), mediaType: audio.type, durationMs }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Transcription failed. Try again.');
  if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 12_000) throw new Error('No usable speech was detected. Try again.');
  return result.text.trim();
}

/** One explicitly started microphone recording, shared between desktop and XR. */
export class VoiceDictation {
  readonly state: DictationState;
  private listeners = new Set<(state: DictationState) => void>();
  private deps: Dependencies;
  private stream: MediaStream | undefined;
  private recorder: Recorder | undefined;
  private request: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(deps: Partial<Dependencies> = {}) {
    this.deps = {
      supported: typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
      capture: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }),
      recorder: stream => {
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
        return new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
      },
      transcribe: upload, ...deps,
    };
    this.state = { phase: 'idle', draft: '', error: null, micReady: false, supported: this.deps.supported };
  }
  subscribe(listener: (state: DictationState) => void) {
    this.listeners.add(listener); listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  private patch(value: Partial<DictationState>) { Object.assign(this.state, value); for (const fn of this.listeners) fn(this.state); }
  private release() {
    clearTimeout(this.timer); this.timer = undefined;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.state.micReady = false;
  }
  private fail(message: string) { this.cancel(); this.patch({ phase: 'error', error: message }); }

  /** Grant microphone permission before entering XR when the headset requires it. */
  async prepare(): Promise<boolean> {
    if (!this.state.supported) { this.fail('This browser cannot record audio. Open the workspace in Meta Quest Browser over HTTPS.'); return false; }
    if (this.stream?.getAudioTracks().some(track => track.readyState === 'live')) return true;
    const token = ++this.generation;
    this.patch({ phase: 'preparing', error: null });
    try {
      const stream = await this.deps.capture();
      if (token !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.stream = stream;
      this.patch({ phase: this.state.draft ? 'review' : 'idle', micReady: true });
      return true;
    } catch (error) {
      if (token !== this.generation) return false;
      const denied = error instanceof Error && ['NotAllowedError', 'SecurityError'].includes(error.name);
      this.fail(denied ? 'Microphone permission is needed. Choose Back to browser, enable the microphone, then enter XR again.' : 'Cannot access the microphone. Check the headset microphone and browser permissions.');
      return false;
    }
  }

  async start() {
    if (['preparing', 'recording', 'transcribing'].includes(this.state.phase)) return;
    if (!await this.prepare() || !this.stream) return;
    const token = ++this.generation;
    const chunks: Blob[] = [];
    let size = 0;
    const began = Date.now();
    try {
      const recorder = this.recorder = this.deps.recorder(this.stream);
      recorder.ondataavailable = event => {
        if (token !== this.generation) return;
        size += event.data.size;
        if (size > 1_500_000) { this.fail('Recording is too large. Dictate a shorter message.'); return; }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => { if (token === this.generation) this.fail('Recording stopped unexpectedly. Try dictating again.'); };
      recorder.onstop = () => {
        if (token !== this.generation) return;
        this.recorder = undefined; this.release();
        if (!size) { this.fail('No audio was recorded. Try again.'); return; }
        const type = (recorder.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0];
        const audio = new Blob(chunks, { type });
        chunks.length = 0;
        const request = this.request = new AbortController();
        this.patch({ phase: 'transcribing', draft: '', error: null });
        void this.deps.transcribe(audio, Math.max(1, Math.min(45_000, Date.now() - began)), request.signal).then(text => {
          if (token === this.generation) this.patch({ phase: 'review', draft: text, error: null });
        }).catch(error => {
          if (token === this.generation && !request.signal.aborted) this.fail(error instanceof Error ? error.message : 'Transcription failed. Try again.');
        }).finally(() => { if (this.request === request) this.request = undefined; });
      };
      recorder.start(1000);
      this.timer = setTimeout(() => this.stop(), 45_000);
      this.patch({ phase: 'recording', draft: '', error: null });
    } catch { if (token === this.generation) this.fail('This browser could not start audio recording. Try enabling the microphone before entering XR.'); }
  }
  stop() { if (this.recorder?.state === 'recording') this.recorder.stop(); }
  cancel() {
    this.generation++;
    this.request?.abort(); this.request = undefined;
    if (this.recorder) {
      this.recorder.onstop = null; this.recorder.ondataavailable = null; this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = undefined;
    }
    this.release(); this.patch({ phase: 'idle', draft: '', error: null });
  }
}

export const dictation = new VoiceDictation();
