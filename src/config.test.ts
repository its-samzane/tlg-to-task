import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: '123:abc',
  OWNER_TELEGRAM_ID: '42',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
};

describe('loadConfig', () => {
  it('applies defaults for optional values', () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.OWNER_TELEGRAM_ID).toBe(42);
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(config.OPENAI_MODEL).toBe('gpt-4o-mini');
    expect(config.OPENAI_TRANSCRIPTION_MODEL).toBe('gpt-4o-transcribe');
    expect(config.BOT_LANGUAGE).toBe('en');
    expect(config.TZ).toBe('UTC');
    expect(config.STORAGE_DIR).toBe('./storage');
    expect(config.ALLOW_MEMBER_DELETE).toBe(false);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ ...baseEnv, OPENAI_API_KEY: '', OPENAI_MODEL: '  ' });
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(config.OPENAI_MODEL).toBe('gpt-4o-mini');
  });

  it('parses booleans and numbers', () => {
    const config = loadConfig({ ...baseEnv, ALLOW_MEMBER_DELETE: 'true', OWNER_TELEGRAM_ID: '7' });
    expect(config.ALLOW_MEMBER_DELETE).toBe(true);
    expect(config.OWNER_TELEGRAM_ID).toBe(7);
  });

  it('rejects missing required values with a readable message', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x' })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('rejects invalid time zones', () => {
    expect(() => loadConfig({ ...baseEnv, TZ: 'Mars/Olympus' })).toThrow(/TZ/);
  });

  it('accepts a valid time zone', () => {
    expect(loadConfig({ ...baseEnv, TZ: 'Asia/Tehran' }).TZ).toBe('Asia/Tehran');
  });
});
