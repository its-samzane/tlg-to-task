import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Api } from 'grammy';
import { applyCommandMenu, createBot } from './bot/bot.js';
import type { Deps } from './bot/context.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createI18n } from './i18n.js';
import { createLogger } from './logger.js';
import { createFileStore } from './services/files.js';
import {
  createOpenAiClient,
  createOpenAiTitleGenerator,
  createOpenAiTranscriber,
} from './services/openai.js';
import { PendingWork } from './services/pending.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const i18n = await createI18n({ language: config.BOT_LANGUAGE, timeZone: config.TZ });

  const storageDir = path.resolve(config.STORAGE_DIR);
  await mkdir(storageDir, { recursive: true });

  const handle = createDb(config.DATABASE_URL);
  await runMigrations(handle.db);
  logger.info('Database ready');

  const deps: Deps = {
    config,
    db: handle.db,
    i18n,
    logger,
    files: createFileStore({
      storageDir,
      api: new Api(config.TELEGRAM_BOT_TOKEN),
      token: config.TELEGRAM_BOT_TOKEN,
    }),
    pending: new PendingWork(),
  };

  if (config.OPENAI_API_KEY) {
    const client = createOpenAiClient({
      apiKey: config.OPENAI_API_KEY,
      baseURL: config.OPENAI_BASE_URL,
    });
    const hint = config.TRANSCRIPTION_LANGUAGE ?? config.BOT_LANGUAGE;
    deps.transcriber = createOpenAiTranscriber(client, {
      model: config.OPENAI_TRANSCRIPTION_MODEL,
      language: hint === 'auto' ? undefined : hint,
    });
    deps.titles = createOpenAiTitleGenerator(client, { model: config.OPENAI_MODEL });
    logger.info(
      { model: config.OPENAI_MODEL, transcriptionModel: config.OPENAI_TRANSCRIPTION_MODEL, hint },
      'OpenAI enabled',
    );
  } else {
    logger.warn(
      'OPENAI_API_KEY is not set: voice messages will not be transcribed and titles will use the first line of text',
    );
  }

  const bot = createBot(deps);
  await applyCommandMenu(bot, deps);

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    bot.stop();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await bot.start({
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    onStart: (me) =>
      logger.info(
        { username: me.username, language: config.BOT_LANGUAGE, timeZone: config.TZ },
        'Bot started',
      ),
  });

  await handle.close();
  logger.info('Stopped');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
