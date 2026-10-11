// Browser storage for per-person conveniences only (a remembered name, a collapsed panel). It can be empty or
// throw (private windows, blocked site data), so every access is guarded and the app works without it.

export function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* not remembered; nothing breaks */ }
}
