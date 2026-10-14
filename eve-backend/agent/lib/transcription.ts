import { gateway, transcribe } from 'ai';
import { workbenchAuthorized } from './workbench-auth.ts';

export const TRANSCRIPTION_MODEL = 'openai/gpt-4o-mini-transcribe';
const MAX_REQUEST = 2_100_000;
const MAX_AUDIO = 1_500_000;
const TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav']);
type Recognizer = (audio: Uint8Array, signal: AbortSignal) => Promise<{ text: string }>;
const recognize: Recognizer = (audio, signal) => transcribe({
  model: gateway.transcription(TRANSCRIPTION_MODEL), audio, abortSignal: signal, maxRetries: 0,
});
const json = (body: object, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Audio is transient input to transcription; it is never saved to agent history. */
export async function transcribeAudio(request: Request, run: Recognizer = recognize): Promise<Response> {
  if (!workbenchAuthorized(request)) return json({ error: 'Authentication required.' }, 401);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Expected an audio recording.' }, 415);
  if (Number(request.headers.get('content-length')) > MAX_REQUEST) return json({ error: 'Recording is too large. Try a shorter message.' }, 413);
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'No recording received.' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_REQUEST) { await reader.cancel(); return json({ error: 'Recording is too large.' }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return json({ error: 'Invalid recording request.' }, 400); }
  if (!input || typeof input !== 'object' || typeof input.audio !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio) || input.audio.length % 4 !== 0
    || !TYPES.has(input.mediaType) || !Number.isFinite(input.durationMs)
    || input.durationMs <= 0 || input.durationMs > 45_000) return json({ error: 'Use a recording of up to 45 seconds.' }, 400);
  const audio = Buffer.from(input.audio, 'base64');
  if (!audio.length || audio.length > MAX_AUDIO) return json({ error: 'Recording is too large. Try a shorter message.' }, 413);
  try {
    const result = await run(audio, AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]));
    const text = result.text.trim();
    if (!text) return json({ error: 'No speech was detected. Please try again.' }, 422);
    if (text.length > 12_000) return json({ error: 'Transcript is too long. Try a shorter message.' }, 422);
    return json({ text, model: TRANSCRIPTION_MODEL });
  } catch {
    return json({ error: 'Speech transcription failed. Please try again.', code: 'transcription_failed' }, 502);
  }
}
