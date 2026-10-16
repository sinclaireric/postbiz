'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Locale } from './config';
import { createTranslator, type Messages } from './translate';
import type { T } from './types';

const Context = createContext<T | null>(null);

/** Fournit le traducteur aux composants clients. Les textes arrivent déjà complétés (anglais, français) du serveur. */
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const t = useMemo(() => createTranslator(locale, [messages]) as unknown as T, [locale, messages]);
  return <Context.Provider value={t}>{children}</Context.Provider>;
}

export function useT(): T {
  const t = useContext(Context);
  if (!t) throw new Error('useT doit être utilisé sous <I18nProvider>');
  return t;
}

export const useLocale = (): Locale => useT().locale;
