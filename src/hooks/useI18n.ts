import { useEffect, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LANGUAGE_STORAGE_KEY,
  isSupportedLocale,
  normalizeLocale,
  type SupportedLocale,
} from '@/i18n/config';

export function useI18n() {
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    const savedLanguage = normalizeLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY));
    setCurrentLocale(savedLanguage);
  }, []);

  const changeLanguage = (locale: string) => {
    const nextLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;

    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
    setCurrentLocale(nextLocale);
    // 刷新页面以应用新语言
    window.location.reload();
  };

  return {
    currentLocale,
    changeLanguage,
  };
}
