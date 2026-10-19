import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

export type Language = 'fr' | 'en';
export type TranslationKey = keyof typeof en;
export const languageStorageKey = 'dvf-explorer.language';
export function preferredLanguage(): Language {
  try {
    const saved = localStorage.getItem(languageStorageKey);
    return saved === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}
export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: preferredLanguage(),
  fallbackLng: 'fr',
  supportedLngs: ['fr', 'en'],
  keySeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
});

export function getLocale() {
  return i18n.resolvedLanguage === 'en' ? 'en-GB' : 'fr-FR';
}
function syncDocument() {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'fr';
  document.title = i18n.t('app.pageTitle');
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', i18n.t('app.description'));
}
i18n.on('languageChanged', syncDocument);
syncDocument();

export async function changeLanguage(language: Language) {
  await i18n.changeLanguage(language);
  try {
    localStorage.setItem(languageStorageKey, language);
  } catch {
    // Translation remains available when browser storage is disabled.
  }
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    keySeparator: false;
    resources: { translation: typeof en };
  }
}
