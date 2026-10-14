import { eveVoice } from './eve-voice.js';

export function mountVoiceControls(host: HTMLElement) {
  host.innerHTML = '<button type="button" class="eve-voice-toggle" aria-pressed="false">Voice off</button><button type="button" class="eve-voice-stop">Stop reading</button><label class="eve-sr-only" for="eve-voice-choice">Reply voice</label><select id="eve-voice-choice" aria-label="Reply voice"><option value="">Device default voice</option></select><span class="eve-voice-status" role="status"></span>';
  const toggle = host.querySelector<HTMLButtonElement>('.eve-voice-toggle')!;
  const stop = host.querySelector<HTMLButtonElement>('.eve-voice-stop')!;
  const choice = host.querySelector<HTMLSelectElement>('select')!;
  const status = host.querySelector<HTMLSpanElement>('.eve-voice-status')!;
  let key = '';
  const unsubscribe = eveVoice.subscribe(state => {
    toggle.disabled = !state.supported;
    toggle.textContent = state.enabled ? 'Voice on' : 'Voice off';
    toggle.setAttribute('aria-pressed', String(state.enabled));
    toggle.title = 'Read Eve’s replies aloud as they arrive';
    stop.disabled = !state.speaking;
    choice.disabled = !state.supported;
    status.textContent = state.error || (!state.supported ? 'Speech unavailable in this browser.' : state.speaking ? 'Reading aloud' : 'Uses your device’s available voices.');
    const next = JSON.stringify(state.voices.map(voice => [voice.voiceURI, voice.name, voice.lang]));
    if (next !== key) {
      key = next; choice.replaceChildren(new Option('Device default voice', ''));
      for (const voice of state.voices) choice.add(new Option(`${voice.name} (${voice.lang})`, voice.voiceURI));
    }
    choice.value = state.voiceURI;
  });
  const onToggle = () => eveVoice.setEnabled(!eveVoice.state.enabled);
  const onStop = () => eveVoice.stop();
  const onChoice = () => eveVoice.selectVoice(choice.value);
  toggle.addEventListener('click', onToggle); stop.addEventListener('click', onStop); choice.addEventListener('change', onChoice);
  return () => { unsubscribe(); toggle.removeEventListener('click', onToggle); stop.removeEventListener('click', onStop); choice.removeEventListener('change', onChoice); host.replaceChildren(); };
}
