import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceDictation } from '../src/eve-dictation.ts';
import { transcribeAudio } from '../eve-backend/agent/lib/transcription.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function microphone() {
  let stops = 0;
  const track = { readyState: 'live', stop() { stops++; this.readyState = 'ended'; } };
  return { stream: { getTracks: () => [track], getAudioTracks: () => [track] }, stops: () => stops };
}
function recorder() {
  return { state: 'inactive', mimeType: 'audio/webm;codecs=opus',
    ondataavailable: null, onstop: null, onerror: null,
    start() { this.state = 'recording'; },
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['recorded-audio'], { type: this.mimeType }) });
      this.onstop?.();
    },
  };
}

test('headset recording stops the microphone before transcription and produces a review draft', async () => {
  const mic = microphone(), recording = recorder();
  let finish;
  const voice = new VoiceDictation({ supported: true, capture: async () => mic.stream, recorder: () => recording,
    transcribe: async (audio, duration, signal) => {
      assert.equal(mic.stops(), 1);
      assert.equal(audio.type, 'audio/webm');
      assert.ok(duration > 0 && duration <= 45_000);
      assert.equal(signal.aborted, false);
      return new Promise(resolve => { finish = resolve; });
    } });
  try {
    await voice.start(); assert.equal(voice.state.phase, 'recording');
    voice.stop(); assert.equal(voice.state.phase, 'transcribing');
    finish('Please plan my day.'); await tick();
    assert.equal(voice.state.phase, 'review');
    assert.equal(voice.state.draft, 'Please plan my day.');
    assert.equal(voice.state.micReady, false);
  } finally { voice.cancel(); }
});

test('leaving XR while permission is pending releases a late microphone and never records', async () => {
  const mic = microphone(); let allow;
  const voice = new VoiceDictation({ supported: true,
    capture: () => new Promise(resolve => { allow = resolve; }),
    recorder: () => assert.fail('cancelled permission must not start recording'),
  });
  const start = voice.start(); voice.cancel(); allow(mic.stream); await start;
  assert.equal(mic.stops(), 1); assert.equal(voice.state.phase, 'idle');
});

test('discard aborts transcription and ignores a late transcript', async () => {
  const mic = microphone(), recording = recorder(); let finish, signal;
  const voice = new VoiceDictation({ supported: true, capture: async () => mic.stream, recorder: () => recording,
    transcribe: (_, __, abort) => { signal = abort; return new Promise(resolve => { finish = resolve; }); },
  });
  await voice.start(); voice.stop(); voice.cancel(); finish('stale transcript'); await tick();
  assert.equal(signal.aborted, true); assert.equal(voice.state.phase, 'idle'); assert.equal(voice.state.draft, '');
});

test('recording automatically stops after 45 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mic = microphone(), recording = recorder();
  const voice = new VoiceDictation({ supported: true, capture: async () => mic.stream, recorder: () => recording, transcribe: async () => 'A bounded recording.' });
  try {
    await voice.start(); t.mock.timers.tick(45_000); await tick();
    assert.equal(recording.state, 'inactive'); assert.equal(mic.stops(), 1); assert.equal(voice.state.phase, 'review');
  } finally { voice.cancel(); }
});

test('dictation uploads only to the protected transcription endpoint and does not send a chat turn', async t => {
  const mic = microphone(), recording = recorder(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async function (url, options) {
    assert.equal(this, globalThis);
    assert.equal(url, '/api/eve/transcribe'); assert.equal(options.credentials, 'same-origin');
    const body = JSON.parse(options.body);
    assert.equal(Buffer.from(body.audio, 'base64').toString(), 'recorded-audio');
    assert.equal(body.mediaType, 'audio/webm'); calls++;
    return Response.json({ text: 'Review me before sending.' });
  });
  const voice = new VoiceDictation({ supported: true, capture: async () => mic.stream, recorder: () => recording });
  try {
    await voice.start(); voice.stop(); await tick();
    assert.equal(calls, 1); assert.equal(voice.state.phase, 'review');
    assert.equal(voice.state.draft, 'Review me before sending.');
  } finally { voice.cancel(); }
});

const serviceKey = 'test-transcription-service-key-at-least-32-characters';
function audioRequest(body, authorized = true) {
  return new Request('https://agent.example/workbench/transcribe', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${serviceKey}` } : {}) },
    body: JSON.stringify(body),
  });
}
const input = { audio: Buffer.from('test-audio-bytes').toString('base64'), mediaType: 'audio/webm', durationMs: 1000 };

test('transcription authenticates before invoking the speech model and returns text only', async () => {
  process.env.EVE_API_KEY = serviceKey;
  const locked = await transcribeAudio(audioRequest(input, false), () => assert.fail('must authenticate first'));
  assert.equal(locked.status, 401);
  const response = await transcribeAudio(audioRequest(input), async bytes => {
    assert.equal(Buffer.from(bytes).toString(), 'test-audio-bytes');
    return { text: '  Hello Eve.  ' };
  });
  assert.deepEqual(await response.json(), { text: 'Hello Eve.', model: 'openai/gpt-4o-mini-transcribe' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('invalid and oversized recordings never reach the transcription model', async () => {
  process.env.EVE_API_KEY = serviceKey;
  for (const body of [null, {}, { ...input, audio: '?' }, { ...input, mediaType: 'text/html' }, { ...input, durationMs: 45_001 }]) {
    const response = await transcribeAudio(audioRequest(body), () => assert.fail('must reject input first'));
    assert.equal(response.status, 400);
  }
  const oversized = await transcribeAudio(audioRequest({ ...input, audio: 'a'.repeat(2_100_004) }), () => assert.fail('must bound audio first'));
  assert.equal(oversized.status, 413);
  const empty = await transcribeAudio(audioRequest(input), async () => ({ text: '   ' }));
  assert.equal(empty.status, 422);
  const failure = await transcribeAudio(audioRequest(input), async () => { throw new Error('private-provider-key'); });
  assert.equal(failure.status, 502); assert.ok(!(await failure.text()).includes('private-provider-key'));
});
