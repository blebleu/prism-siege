// Save data kept in this browser. Every game on treasurepast.com shares one browser storage area, so all of this
// game's saves live under "tp:prism-siege:<slot>". Each save records a format version, so a later release can
// upgrade (or drop) saves written by an older one. Nothing here throws: when storage is blocked (private mode,
// site data disabled) or full, saving quietly does nothing and loading finds no save.
export const PREFIX = 'tp:prism-siege:';

const storage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

// The saved data for a slot, or null. upgrade(data, fromVersion) converts an older save and returns it (or null
// to drop it); saves from a newer version than this code understands are ignored.
export function loadSave(slot, version, upgrade = () => null) {
  try {
    const saved = JSON.parse(storage()?.getItem(PREFIX + slot));
    if (!saved || typeof saved !== 'object' || !Number.isInteger(saved.v) || !('data' in saved)) return null;
    if (saved.v === version) return saved.data;
    return saved.v < version ? upgrade(saved.data, saved.v) ?? null : null;
  } catch {
    return null;
  }
}

export function writeSave(slot, version, data) {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(PREFIX + slot, JSON.stringify({ v: version, savedAt: Date.now(), data }));
    return true;
  } catch {
    return false;
  }
}

export function removeSave(slot) {
  try { storage()?.removeItem(PREFIX + slot); } catch {}
}

// Asks the browser to keep this site's storage instead of clearing it when space runs low. Browsers decide on
// their own (Chrome and Safari silently; Firefox asks the player once), so this runs only after the player has
// progress worth keeping, and only once per browser.
export function requestPersistentStorage() {
  const store = storage();
  try {
    if (!navigator.storage?.persist || store?.getItem(PREFIX + 'persist-asked')) return;
    store?.setItem(PREFIX + 'persist-asked', '1');
    navigator.storage.persisted().then(already => already || navigator.storage.persist()).catch(() => {});
  } catch {}
}
