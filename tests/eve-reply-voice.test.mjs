import test from 'node:test';
import assert from 'node:assert/strict';
import { EveClient } from '../src/eve-client.ts';
import { ReplyVoice } from '../src/eve-reply-voice.ts';

function fixture() {
  const spoken = [], listeners = new Set();
  const synth = { getVoices: () => [{ voiceURI: 'device', name: 'Device voice', lang: 'en-US', default: true }],
    speak: value => spoken.push(value), cancel() {},
    addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) };
  const client = new EveClient();
  const voice = new ReplyVoice(client, synth, text => ({ text }));
  const event = (type, data) => client.applyEvent({ type, data });
  let step = 0;
  const start = (turn = 'live') => {
    step++;
    client.state.messages.push({ id: `user_${step}`, role: 'user', text: `Hello ${step}`, pending: true });
    event('turn.started', { turnId: turn });
    event('message.received', { turnId: turn, message: `Hello ${step}` });
  };
  const finish = () => spoken.at(-1).onend?.();
  return { client, voice, event, start, spoken, finish, listeners };
}

test('voice reads fresh streamed sentences before completion and flushes the final fragment once', () => {
  const f = fixture();
  try {
    f.voice.setEnabled(true); f.finish(); f.start();
    f.event('message.appended', { turnId: 'live', stepIndex: 0, messageDelta: 'Hello ' });
    assert.deepEqual(f.spoken.map(value => value.text), ['Voice on.']);
    f.event('message.appended', { turnId: 'live', stepIndex: 0, messageDelta: 'world. Next ' });
    assert.equal(f.spoken.at(-1).text, 'Hello world.');
    assert.equal(f.client.state.phase, 'working');
    f.finish();
    f.event('message.completed', { turnId: 'live', stepIndex: 0, message: 'Hello world. Next step' });
    assert.equal(f.spoken.at(-1).text, 'Next step');
    f.finish();
    f.event('message.completed', { turnId: 'live', stepIndex: 0, message: 'Hello world. Next step' });
    assert.equal(f.spoken.length, 3);
    assert.equal(f.spoken[1].voice.voiceURI, 'device');
  } finally { f.voice.dispose(); f.client.dispose(); }
  assert.equal(f.listeners.size, 0);
});

test('history replay stays silent and stop discards queued and later text from the current turn', () => {
  const f = fixture();
  try {
    f.voice.setEnabled(true); f.finish();
    f.event('turn.started', { turnId: 'historical' });
    f.event('message.received', { turnId: 'historical', message: 'Old request' });
    f.event('message.completed', { turnId: 'historical', stepIndex: 0, message: 'Never read replayed history.' });
    assert.equal(f.spoken.length, 1);
    f.start();
    f.event('message.appended', { turnId: 'live', stepIndex: 0, messageDelta: 'First sentence. Second sentence.' });
    const cancelled = f.spoken.at(-1);
    f.voice.stop(); cancelled.onend();
    f.event('message.completed', { turnId: 'live', stepIndex: 0, message: 'First sentence. Second sentence. Extra tail.' });
    assert.equal(f.spoken.length, 2);
    f.start('next');
    f.event('message.completed', { turnId: 'next', stepIndex: 0, message: 'New turn can speak.' });
    assert.equal(f.spoken.at(-1).text, 'New turn can speak.');
  } finally { f.voice.dispose(); f.client.dispose(); }
});

test('mute, cancellation, conversation changes, and speech failures stop playback', async () => {
  const f = fixture();
  try {
    f.voice.setEnabled(true); f.finish(); f.start();
    f.event('message.appended', { turnId: 'live', stepIndex: 0, messageDelta: 'Speaking. Queued.' });
    f.event('turn.cancelled', { turnId: 'live' });
    assert.equal(f.voice.state.speaking, false);
    f.voice.setEnabled(false);
    f.start('muted'); f.event('message.completed', { turnId: 'muted', stepIndex: 0, message: 'Stay silent.' });
    assert.equal(f.spoken.length, 2);
    f.voice.setEnabled(true); f.finish(); f.start('failure');
    f.event('message.completed', { turnId: 'failure', stepIndex: 0, message: 'Try speaking.' });
    f.spoken.at(-1).onerror({ error: 'not-allowed' });
    assert.equal(f.voice.state.enabled, false);
    assert.match(f.voice.state.error, /not-allowed/);
    assert.equal(f.voice.state.speaking, false);
  } finally { f.voice.dispose(); f.client.dispose(); }
});

test('an unavailable speech API remains explicit and does not affect text', () => {
  const client = new EveClient(), voice = new ReplyVoice(client, null);
  try {
    voice.setEnabled(true);
    assert.equal(voice.state.enabled, false);
    assert.match(voice.state.error, /unavailable/);
    client.applyEvent({ type: 'message.completed', data: { turnId: 't', stepIndex: 0, message: 'Still readable.' } });
    assert.equal(client.state.messages[0].text, 'Still readable.');
  } finally { voice.dispose(); client.dispose(); }
});
