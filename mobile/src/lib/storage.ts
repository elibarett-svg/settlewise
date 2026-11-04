import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Token storage: the device keychain/keystore on iOS and Android; localStorage on
 * web (development previews and the web demo), which some browsers block. */
function web<T>(fn: (store: Storage) => T, fallback: T): T {
  try {
    return globalThis.localStorage ? fn(globalThis.localStorage) : fallback;
  } catch {
    return fallback;
  }
}

export const storage = {
  get: async (key: string): Promise<string | null> =>
    Platform.OS === 'web' ? web((s) => s.getItem(key), null) : SecureStore.getItemAsync(key),
  set: async (key: string, value: string): Promise<void> =>
    Platform.OS === 'web' ? web((s) => s.setItem(key, value), undefined) : SecureStore.setItemAsync(key, value),
  remove: async (key: string): Promise<void> =>
    Platform.OS === 'web' ? web((s) => s.removeItem(key), undefined) : SecureStore.deleteItemAsync(key),
};
