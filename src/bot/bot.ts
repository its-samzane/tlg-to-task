import { Bot } from 'grammy';
import { COMMANDS, registerBasicCommands } from './commands/basic.js';
import type { AppContext, Deps } from './context.js';

export function createBot(deps: Deps): Bot<AppContext> {
  const bot = new Bot<AppContext>(deps.config.TELEGRAM_BOT_TOKEN);

  bot.use(async (ctx, next) => {
    ctx.deps = deps;
    ctx.t = deps.i18n.t;
    await next();
  });

  registerBasicCommands(bot);

  bot.catch((error) => {
    deps.logger.error(
      { err: error.error, updateId: error.ctx.update.update_id },
      'Unhandled error while processing update',
    );
  });

  return bot;
}

/** Publishes the command menu (the "/" button in Telegram) using the configured language. */
export async function applyCommandMenu(bot: Bot<AppContext>, deps: Deps): Promise<void> {
  await bot.api.setMyCommands(
    COMMANDS.map((command) => ({ command, description: deps.i18n.t.raw(`commands.${command}`) })),
  );
}
