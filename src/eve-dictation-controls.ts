import { eve } from './eve-client.js';
import { dictation } from './eve-dictation.js';
import { eveVoice } from './eve-voice.js';

export function mountDictationControls(shell: HTMLElement, textarea: HTMLTextAreaElement) {
  const mic = shell.querySelector<HTMLButtonElement>('.eve-mic')!;
  const launch = shell.querySelector<HTMLButtonElement>('.eve-xr')!;
  const enable = document.createElement('button');
  enable.type = 'button'; enable.className = 'eve-xr eve-enable-mic';
  launch.before(enable);
  const status = document.createElement('div');
  status.className = 'eve-dictation-status'; status.setAttribute('role', 'status');
  textarea.after(status);
  let delivered = '';
  let session = eve.state.sessionId;
  const render = () => {
    const state = dictation.state;
    const available = ['ready', 'waiting'].includes(eve.state.phase);
    const busy = ['preparing', 'transcribing'].includes(state.phase);
    enable.hidden = !state.supported;
    enable.disabled = !available || busy || state.phase === 'recording';
    enable.textContent = state.micReady ? 'Microphone ready' : state.phase === 'preparing' ? 'Allow microphone...' : 'Enable microphone';
    enable.title = 'Allow the headset microphone before entering XR';
    mic.hidden = !state.supported;
    mic.disabled = (!available && state.phase !== 'recording') || busy;
    mic.setAttribute('aria-pressed', String(state.phase === 'recording'));
    mic.setAttribute('aria-label', state.phase === 'recording' ? 'Stop recording' : 'Dictate a message');
    mic.title = state.phase === 'recording' ? 'Stop recording' : 'Dictate a message';
    status.textContent = state.error || (state.phase === 'recording' ? 'Microphone on. Tap the mic to stop (45 seconds maximum).'
      : state.phase === 'transcribing' ? 'Transcribing your recording...'
      : state.phase === 'preparing' ? 'Allow microphone access in your browser.'
      : state.phase === 'review' ? 'Voice draft ready. Review or edit it, then send.'
      : state.micReady ? 'Microphone ready. In XR, choose Dictate to start.' : '');
    status.hidden = !status.textContent;
    if (state.phase === 'review' && state.draft !== delivered) {
      delivered = state.draft; textarea.value = state.draft;
      textarea.dispatchEvent(new Event('input'));
    }
    if (state.phase === 'recording') delivered = '';
    if (state.phase === 'idle' && delivered) {
      if (textarea.value === delivered) { textarea.value = ''; textarea.dispatchEvent(new Event('input')); }
      delivered = '';
    }
  };
  const stopVoice = dictation.subscribe(render);
  const stopEve = eve.subscribe(state => {
    if (state.sessionId !== session || ['locked', 'setup'].includes(state.phase)) {
      session = state.sessionId;
      if (dictation.state.phase !== 'idle' || dictation.state.micReady) dictation.cancel();
    }
    render();
  });
  const onEnable = () => { if (dictation.state.micReady) dictation.cancel(); else void dictation.prepare(); };
  const onMic = () => { if (dictation.state.phase === 'recording') dictation.stop(); else { eveVoice.stop(); void dictation.start(); } };
  enable.addEventListener('click', onEnable); mic.addEventListener('click', onMic);
  return () => {
    stopVoice(); stopEve(); dictation.cancel();
    enable.removeEventListener('click', onEnable); mic.removeEventListener('click', onMic);
    enable.remove(); status.remove();
  };
}
