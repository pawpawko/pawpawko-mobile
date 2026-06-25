import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Read-side offline cache.
//
// Plain AsyncStorage JSON blobs (a user's own binders are small — a handful of
// binders, tens-to-low-hundreds of listings each). No SQLite: the data is tiny
// and AsyncStorage is already a dependency. Card *art* is handled separately by
// expo-image's on-disk cache, so cached binders render their images offline.
//
// Scope: only the signed-in user's OWN binders are cached (see callers), so a
// player can always open their binder and show what they have with no signal.
// ---------------------------------------------------------------------------

export const cacheKeys = {
  myBinders: (uid: string) => `pawpaw:cache:binders:${uid}`,
  binder: (binderId: string) => `pawpaw:cache:binder:${binderId}`,
};

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort: a failed cache write just means a cold read next time.
  }
}

export async function removeCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}
