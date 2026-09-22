import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createI18n, flattenMessages, listLanguages, localesDir } from './i18n.js';

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe('locale files', () => {
  it('all languages define the same keys and placeholders as English', async () => {
    const languages = await listLanguages();
    expect(languages).toContain('en');
    const en = flattenMessages(
      JSON.parse(await readFile(path.join(localesDir, 'en.json'), 'utf8')),
    );

    for (const language of languages) {
      const parsed = JSON.parse(await readFile(path.join(localesDir, `${language}.json`), 'utf8'));
      expect(parsed._meta, `${language}: missing _meta`).toMatchObject({
        name: expect.any(String),
        englishName: expect.any(String),
        intlLocale: expect.any(String),
        rtl: expect.any(Boolean),
      });
      expect(
        Intl.DateTimeFormat.supportedLocalesOf([parsed._meta.intlLocale]),
        `${language}: unsupported intlLocale`,
      ).toHaveLength(1);
      const messages = flattenMessages(parsed);
      expect(Object.keys(messages).sort(), `${language}: key set differs from en`).toEqual(
        Object.keys(en).sort(),
      );
      for (const [key, template] of Object.entries(messages)) {
        expect(placeholders(template), `${language}: placeholders differ in "${key}"`).toEqual(
          placeholders(en[key]!),
        );
        expect(template.trim(), `${language}: empty translation for "${key}"`).not.toBe('');
      }
    }
  });
});

describe('createI18n', () => {
  it('translates with HTML-escaped parameters', async () => {
    const i18n = await createI18n({ language: 'en', timeZone: 'UTC' });
    expect(i18n.t('id.text', { userId: '<b>1</b>', chatId: 2 })).toContain('&lt;b&gt;1&lt;/b&gt;');
    expect(i18n.t.raw('id.text', { userId: '<b>1</b>', chatId: 2 })).toContain('<b>1</b>');
  });

  it('throws for unknown keys and languages', async () => {
    const i18n = await createI18n({ language: 'en', timeZone: 'UTC' });
    expect(() => i18n.t('does.not.exist')).toThrow(/Missing translation/);
    await expect(createI18n({ language: 'xx', timeZone: 'UTC' })).rejects.toThrow(
      /Available languages/,
    );
  });

  it('formats dates in the selected locale and time zone', async () => {
    const date = new Date('2026-03-21T12:30:00Z');
    const en = await createI18n({ language: 'en', timeZone: 'UTC' });
    expect(en.formatDateTime(date)).toMatch(/Mar 21, 2026/);

    const fa = await createI18n({ language: 'fa', timeZone: 'Asia/Tehran' });
    // Persian locale uses the Solar Hijri calendar and Persian digits: 1 Farvardin 1405, 16:00.
    expect(fa.formatDate(date)).toContain('۱۴۰۵');
    expect(fa.formatTime(date)).toContain('۱۶:۰۰');
  });
});
