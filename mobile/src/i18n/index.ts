import { getLocales } from 'expo-localization';

import { useAuth } from '../auth/AuthContext';
import en from './en';
import fr from './fr';

export type Strings = typeof en;
const dictionaries: Record<string, Strings> = { en, fr };

export function deviceLanguage(): string {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return code in dictionaries ? code : 'en';
}

/** 10.3 Set Display Language - the account setting wins over the device language. */
export function useT(): Strings {
  const { user } = useAuth();
  return dictionaries[user?.display_language ?? deviceLanguage()] ?? en;
}

export function useLocale(): string {
  const { user } = useAuth();
  return (user?.display_language ?? deviceLanguage()) === 'fr' ? 'fr-CA' : 'en-CA';
}
