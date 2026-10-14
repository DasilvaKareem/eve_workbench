import { eve } from './eve-client.js';
import { dictation } from './eve-dictation.js';
import { eveVoice } from './eve-voice.js';
import { promptDraft } from './eve-prompt.js';

export function mountDictationControls(shell: HTMLElement, _textarea: HTMLTextAreaElement) {
  const mic = shell.querySelector<HTMLButtonElement>('.eve-mic')!;
  const status = shell.querySelector<HTMLElement>('.eve-dictation-status')!;
  let delivered = '', session = eve.state.sessionId;
  const render = () => {
    const state = dictation.state;
    const available = ['ready', 'waiting'].includes(eve.state.phase);
    mic.disabled = (!available && state.phase !== 'recording') || ['preparing', 'transcribing'].includes(state.phase);
    mic.hidden = !state.supported;
    mic.setAttribute('aria-pressed', String(state.phase === 'recording'));
    mic.setAttribute('aria-label', state.phase === 'recording' ? 'Stop microphone' : 'Talk');
    mic.title = state.phase === 'recording' ? 'Stop microphone' : 'Talk';
    status.textContent = state.error || (state.phase === 'recording' ? 'Listening… tap the mic to finish.'
      : state.phase === 'transcribing' ? 'Transcribing…'
      : state.phase === 'preparing' ? 'Allow microphone access.' : '');
    status.hidden = !status.textContent;
    if (state.phase === 'review' && state.draft !== delivered) { delivered = state.draft; promptDraft.set(state.draft); }
    if (state.phase === 'recording') delivered = '';
  };
  const stopVoice = dictation.subscribe(render);
  const stopEve = eve.subscribe(state => {
    if (state.sessionId !== session || ['locked', 'setup'].includes(state.phase)) {
      session = state.sessionId;
      if (dictation.state.phase !== 'idle' || dictation.state.micReady) dictation.cancel();
    }
    render();
  });
  const onMic = () => { if (dictation.state.phase === 'recording') dictation.stop(); else { eveVoice.stop(); void dictation.start(); } };
  mic.addEventListener('click', onMic);
  return () => { stopVoice(); stopEve(); dictation.cancel(); mic.removeEventListener('click', onMic); };
}
