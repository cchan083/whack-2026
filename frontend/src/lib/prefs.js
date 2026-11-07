// Small per-browser preferences in localStorage. Storage can be unavailable
// (private windows, blocked site data), so every access is wrapped.
const PREFIX = "rgf:";

export function readPref(key) {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, String(value));
  } catch {
    // Not saved: the setting still works for this visit.
  }
}
