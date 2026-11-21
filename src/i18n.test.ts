import assert from 'node:assert/strict';
import test from 'node:test';

import { detectInitialLocale } from './i18n';

test('maps Portuguese browser locales to the available Brazilian Portuguese catalog', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousOverride = process.env.NEXT_PUBLIC_DF_LOCALE;
  const navigatorStub = { language: 'pt-PT' };

  delete process.env.NEXT_PUBLIC_DF_LOCALE;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: () => null } },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorStub });

  try {
    assert.equal(detectInitialLocale(), 'pt-BR');
    navigatorStub.language = 'pt';
    assert.equal(detectInitialLocale(), 'pt-BR');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (previousOverride === undefined) delete process.env.NEXT_PUBLIC_DF_LOCALE;
    else process.env.NEXT_PUBLIC_DF_LOCALE = previousOverride;
  }
});
