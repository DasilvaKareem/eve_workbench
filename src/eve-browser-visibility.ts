let open = false;
const listeners = new Set<(open: boolean) => void>();
export function showSandboxBrowser(value = true) { open = value; for (const listener of listeners) listener(open); }
export function onSandboxBrowserVisibility(listener: (open: boolean) => void) {
  listeners.add(listener); listener(open);
  return () => { listeners.delete(listener); };
}
