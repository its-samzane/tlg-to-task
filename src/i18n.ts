import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from './util/html.js';

export const localesDir = fileURLToPath(new URL('../locales/', import.meta.url));

export interface LocaleMeta {
  /** Language code, e.g. "fa" (derived from the file name). */
  code: string;
  /** Native name, e.g. "فارسی". */
  name: string;
  /** English name, e.g. "Persian". */
  englishName: string;
  /** BCP 47 locale used for date formatting, e.g. "fa-IR". */
  intlLocale: string;
  /** Whether the language is written right-to-left. */
  rtl: boolean;
}

export type TranslateParams = Record<string, string | number>;

export interface Translate {
  /** Translates a key; parameter values are HTML-escaped (for Telegram HTML messages). */
  (key: string, params?: TranslateParams): string;
  /** Translates a key without escaping parameters (for plain text and Markdown files). */
  raw(key: string, params?: TranslateParams): string;
}

export interface I18n {
  language: string;
  meta: LocaleMeta;
  timeZone: string;
  t: Translate;
  availableLanguages: string[];
  formatDate(date: Date): string;
  formatTime(date: Date): string;
  formatDateTime(date: Date): string;
}

type Messages = Record<string, string>;

interface LoadedLocale {
  meta: LocaleMeta;
  messages: Messages;
}

/** Flattens nested locale objects into dot-separated keys ("a.b.c"). */
export function flattenMessages(input: unknown, prefix = ''): Messages {
  const out: Messages = {};
  if (typeof input !== 'object' || input === null) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === '_meta') continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[fullKey] = value;
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(out, flattenMessages(value, fullKey));
    }
  }
  return out;
}

export async function listLanguages(dir = localesDir): Promise<string[]> {
  const entries = await readdir(dir);
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

export async function loadLocale(code: string, dir = localesDir): Promise<LoadedLocale> {
  const file = path.join(dir, `${code}.json`);
  const parsed = JSON.parse(await readFile(file, 'utf8')) as { _meta?: Partial<LocaleMeta> };
  const meta = parsed._meta ?? {};
  return {
    meta: {
      code,
      name: meta.name ?? code,
      englishName: meta.englishName ?? code,
      intlLocale: meta.intlLocale ?? code,
      rtl: meta.rtl ?? false,
    },
    messages: flattenMessages(parsed),
  };
}

function interpolate(
  template: string,
  params: TranslateParams | undefined,
  escape: boolean,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return escape ? escapeHtml(value) : String(value);
  });
}

export interface I18nOptions {
  language: string;
  timeZone: string;
  localesDir?: string;
}

export async function createI18n(options: I18nOptions): Promise<I18n> {
  const dir = options.localesDir ?? localesDir;
  const availableLanguages = await listLanguages(dir);
  if (!availableLanguages.includes(options.language)) {
    throw new Error(
      `Unsupported BOT_LANGUAGE "${options.language}". Available languages: ${availableLanguages.join(', ')}`,
    );
  }

  const fallback = await loadLocale('en', dir);
  const locale = options.language === 'en' ? fallback : await loadLocale(options.language, dir);
  const messages: Messages = { ...fallback.messages, ...locale.messages };

  const lookup = (key: string): string => {
    const value = messages[key];
    if (value === undefined) {
      throw new Error(`Missing translation key "${key}"`);
    }
    return value;
  };

  const t = ((key: string, params?: TranslateParams) =>
    interpolate(lookup(key), params, true)) as Translate;
  t.raw = (key: string, params?: TranslateParams) => interpolate(lookup(key), params, false);

  const intlLocale = locale.meta.intlLocale;
  const dateFormatter = new Intl.DateTimeFormat(intlLocale, {
    timeZone: options.timeZone,
    dateStyle: 'medium',
  });
  const timeFormatter = new Intl.DateTimeFormat(intlLocale, {
    timeZone: options.timeZone,
    timeStyle: 'short',
  });
  const dateTimeFormatter = new Intl.DateTimeFormat(intlLocale, {
    timeZone: options.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return {
    language: options.language,
    meta: locale.meta,
    timeZone: options.timeZone,
    t,
    availableLanguages,
    formatDate: (date) => dateFormatter.format(date),
    formatTime: (date) => timeFormatter.format(date),
    formatDateTime: (date) => dateTimeFormatter.format(date),
  };
}
