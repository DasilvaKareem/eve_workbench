import type { EveClient, EveEvent } from './eve-client.js';

export interface VoiceState {
  supported: boolean; enabled: boolean; speaking: boolean; error: string | null;
  voices: SpeechSynthesisVoice[]; voiceURI: string;
}

/** Consume only fresh assistant events, enqueue complete sentences, and never read replayed history. */
export class ReplyVoice {
  state: VoiceState;
  private listeners = new Set<(state: VoiceState) => void>();
  private chunks: string[] = [];
  private messages = new Map<string, { text: string; consumed: number }>();
  private current: SpeechSynthesisUtterance | null = null;
  private generation = 0;
  private suppressed = false;
  private unsubscribe: () => void;
  private stopState: () => void;
  private session: string | null;
  private user = '';
  private client: EveClient;
  private synth: SpeechSynthesis | null;
  private utterance: (text: string) => SpeechSynthesisUtterance;

  constructor(client: EveClient, synth: SpeechSynthesis | null = globalThis.speechSynthesis ?? null,
    utterance = (text: string) => new SpeechSynthesisUtterance(text)) {
    this.client = client; this.synth = synth; this.utterance = utterance;
    this.state = { supported: Boolean(synth), enabled: false, speaking: false, error: null, voices: [], voiceURI: '' };
    this.session = client.state.sessionId;
    this.unsubscribe = client.subscribeEvents((event, live) => this.consume(event, live));
    this.stopState = client.subscribe(state => {
      const user = [...state.messages].reverse().find(message => message.role === 'user')?.id || '';
      if (this.session !== state.sessionId || user !== this.user) {
        this.session = state.sessionId; this.user = user;
        this.clear(); this.messages.clear(); this.suppressed = false;
      }
      if (['error', 'locked', 'setup'].includes(state.phase)) this.stop();
    });
    synth?.addEventListener('voiceschanged', this.refreshVoices);
    this.refreshVoices();
  }

  private emit() { for (const listener of this.listeners) listener(this.state); }
  subscribe(listener: (state: VoiceState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private refreshVoices = () => { this.state.voices = this.synth?.getVoices() || []; this.emit(); };
  selectVoice(uri: string) { this.state.voiceURI = uri; this.emit(); }

  setEnabled(enabled: boolean) {
    this.clear();
    this.state.enabled = enabled && this.state.supported;
    this.state.error = enabled && !this.state.supported ? 'Speech is unavailable in this browser.' : null;
    this.messages.clear();
    // Enabling midway through a reply must not read its existing prefix again.
    for (const message of this.client.state.messages) if (message.role === 'assistant') this.messages.set(message.id, { text: message.text, consumed: message.text.length });
    this.suppressed = false;
    // Called directly by a click/pinch, which also activates the browser's speech service.
    if (this.state.enabled) { this.chunks.push('Voice on.'); this.pump(); }
    this.emit();
  }

  stop() { this.suppressed = true; this.clear(); }
  private clear() {
    this.generation++; this.chunks = []; this.current = null;
    this.synth?.cancel(); this.state.speaking = false; this.emit();
  }

  private consume(event: EveEvent, live: boolean) {
    if (['turn.cancelled', 'turn.failed', 'session.failed', 'session.completed'].includes(event.type)) { this.stop(); return; }
    if (!live || !this.state.enabled || this.suppressed || !['message.appended', 'message.completed'].includes(event.type)) return;
    const data = event.data;
    const id = `${data.turnId}:${data.stepIndex}`;
    const message = this.messages.get(id) || { text: '', consumed: 0 };
    if (event.type === 'message.appended' && typeof data.messageDelta === 'string') message.text += data.messageDelta;
    if (event.type === 'message.completed' && typeof data.message === 'string') {
      // A corrected final block must not replay words already queued from its deltas.
      if (data.message.startsWith(message.text)) message.text = data.message;
      else if (!message.consumed) message.text = data.message;
    }
    this.messages.set(id, message);
    let rest = message.text.slice(message.consumed);
    while (rest.length) {
      const sentence = /[.!?](?:["')\]]*)(?:\s|$)|\n/.exec(rest);
      let length = sentence ? sentence.index + sentence[0].length : 0;
      if ((!length || length > 240) && rest.length > 240) {
        length = rest.lastIndexOf(' ', 240);
        if (length < 80) length = Array.from(rest).slice(0, 180).join('').length;
      }
      if (!length && event.type === 'message.completed') length = rest.length;
      if (!length) break;
      const text = rest.slice(0, length).replace(/https?:\/\/\S+/g, 'link').replace(/[`*#_]/g, '').trim();
      message.consumed += length;
      if (text) this.chunks.push(text);
      rest = message.text.slice(message.consumed);
    }
    if (this.chunks.length > 100) { this.state.error = 'Speech fell behind. Voice paused; the full reply is in the panel.'; this.state.enabled = false; this.clear(); return; }
    this.pump();
  }

  private pump() {
    if (this.current || !this.chunks.length || !this.state.enabled || !this.synth) return;
    const generation = this.generation;
    const speech = this.utterance(this.chunks.shift()!);
    const voices = this.state.voices;
    const voice = voices.find(item => item.voiceURI === this.state.voiceURI)
      || voices.find(item => item.default) || voices.find(item => /^en\b/i.test(item.lang));
    if (voice) { speech.voice = voice; speech.lang = voice.lang; }
    speech.rate = 1; speech.pitch = 1; speech.volume = 1;
    speech.onend = () => {
      if (generation !== this.generation) return;
      this.current = null; this.state.speaking = false; this.pump(); this.emit();
    };
    speech.onerror = event => {
      if (generation !== this.generation) return;
      this.state.error = `Voice unavailable (${event.error}). Try another voice or browser.`;
      this.state.enabled = false; this.clear();
    };
    this.current = speech; this.state.speaking = true; this.emit();
    try { this.synth.speak(speech); }
    catch { this.state.error = 'The browser could not start speech. Try enabling voice again.'; this.state.enabled = false; this.clear(); }
  }

  dispose() {
    this.unsubscribe(); this.stopState(); this.clear();
    this.synth?.removeEventListener('voiceschanged', this.refreshVoices); this.listeners.clear();
  }
}
