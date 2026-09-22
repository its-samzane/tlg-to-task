import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  OWNER_TELEGRAM_ID: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).default('gpt-4o-transcribe'),
  OPENAI_BASE_URL: z.url().optional(),

  BOT_LANGUAGE: z.string().min(2).default('en'),
  TRANSCRIPTION_LANGUAGE: z.string().min(2).optional(),
  TZ: z.string().min(1).default('UTC').refine(isValidTimeZone, 'TZ must be a valid IANA time zone'),

  STORAGE_DIR: z.string().min(1).default('./storage'),
  ALLOW_MEMBER_DELETE: z.stringbool().default(false),
  LOG_LEVEL: z.enum(logLevels).default('info'),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Reads and validates configuration from environment variables.
 * Empty strings are treated as "not set" so an `.env` line like `OPENAI_API_KEY=` is allowed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).map(([key, value]) => {
      const trimmed = value?.trim();
      return [key, trimmed === '' ? undefined : trimmed];
    }),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }
  return result.data;
}
