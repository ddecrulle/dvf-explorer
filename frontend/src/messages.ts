import { i18n, type TranslationKey } from './i18n';
import en from './locales/en.json';

// API errors are cached in their original language. Translate at display time so
// switching language also updates messages that were received earlier.
const messages = new Map<string, TranslationKey>(
  Object.entries(en)
    .filter(([key]) => key.startsWith('errors.') || key === 'map.zoomNotice')
    .map(([key, value]) => [value, key as TranslationKey]),
);
export function translateMessage(message: string) {
  const key = messages.get(message);
  if (key) return i18n.t(key);
  const unavailable = /^The service is unavailable \((\d+)\)\.$/.exec(message);
  if (unavailable) return i18n.t('errors.service', { status: unavailable[1] });
  if (
    [
      'Failed to fetch',
      'Load failed',
      'NetworkError when attempting to fetch resource.',
    ].includes(message)
  )
    return i18n.t('errors.network');
  return message;
}
