// Storage abstraction - works in Claude artifacts (window.storage) 
// and falls back to localStorage for real deployments

const PREFIX = "ai_recruit_";

export async function dbGet(k) {
  try {
    if (typeof window !== "undefined" && window.storage) {
      const r = await window.storage.get(k, true);
      return r ? JSON.parse(r.value) : null;
    }
    const v = localStorage.getItem(PREFIX + k);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

export async function dbSet(k, v) {
  try {
    if (typeof window !== "undefined" && window.storage) {
      await window.storage.set(k, JSON.stringify(v), true);
      return;
    }
    localStorage.setItem(PREFIX + k, JSON.stringify(v));
  } catch {}
}

export async function dbList(p) {
  try {
    if (typeof window !== "undefined" && window.storage) {
      const r = await window.storage.list(p, true);
      return r?.keys || [];
    }
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX + p)) {
        keys.push(key.replace(PREFIX, ""));
      }
    }
    return keys;
  } catch { return []; }
}

export async function dbDel(k) {
  try {
    if (typeof window !== "undefined" && window.storage) {
      await window.storage.delete(k, true);
      return;
    }
    localStorage.removeItem(PREFIX + k);
  } catch {}
}
