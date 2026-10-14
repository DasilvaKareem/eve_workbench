/** One draft shared by browser typing, the XR keyboard, and dictation. */
export class PromptDraft {
  text = '';
  private listeners = new Set<(text: string) => void>();
  set(text: string) {
    const next = text.slice(0, 12000);
    if (next === this.text) return;
    this.text = next;
    for (const listener of this.listeners) listener(next);
  }
  insert(text: string) { this.set(this.text + text); }
  backspace() { this.set(Array.from(this.text).slice(0, -1).join('')); }
  subscribe(listener: (text: string) => void) {
    this.listeners.add(listener); listener(this.text);
    return () => { this.listeners.delete(listener); };
  }
}
export const promptDraft = new PromptDraft();
