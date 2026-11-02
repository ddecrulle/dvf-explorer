import { i18n } from '../i18n';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
beforeEach(async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
