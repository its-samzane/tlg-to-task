import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { applyCommandMenu, createBot } from './bot/bot.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createI18n } from './i18n.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const i18n = await createI18n({ language: config.BOT_LANGUAGE, timeZone: config.TZ });

  const storageDir = path.resolve(config.STORAGE_DIR);
  await mkdir(storageDir, { recursive: true });

  const handle = createDb(config.DATABASE_URL);
  await runMigrations(handle.db);
  logger.info('Database ready');

  const deps = { config, db: handle.db, i18n, logger };
  const bot = createBot(deps);
  await applyCommandMenu(bot, deps);

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    bot.stop();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await bot.start({
    allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member'],
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
