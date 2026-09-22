import { Bot, type BotConfig } from 'grammy';
import { getActiveChat } from '../services/chats.js';
import { registerCapture } from './capture.js';
import { registerBasicCommands } from './commands/basic.js';
import { registerManagementCommands } from './commands/manage.js';
import { registerRegistrationCommands } from './commands/register.js';
import type { AppContext, Deps } from './context.js';
import { registerEvents } from './events.js';
import { registerRecordingCommands } from './recording.js';
import { isGroupChat } from './util.js';

export { applyCommandMenu } from './commands/menu.js';

export function createBot(deps: Deps, options: BotConfig<AppContext> = {}): Bot<AppContext> {
  const bot = new Bot<AppContext>(deps.config.TELEGRAM_BOT_TOKEN, options);

  bot.use(async (ctx, next) => {
    ctx.deps = deps;
    ctx.t = deps.i18n.t;
    if (isGroupChat(ctx.chat)) {
      ctx.chatRecord = await getActiveChat(deps.db, ctx.chat!.id);
    }
    await next();
  });

  registerBasicCommands(bot);
  registerRegistrationCommands(bot);
  registerRecordingCommands(bot);
  registerManagementCommands(bot);
  registerEvents(bot);
  registerCapture(bot);

  bot.catch((error) => {
    deps.logger.error(
      { err: error.error, updateId: error.ctx.update.update_id },
      'Unhandled error while processing update',
    );
  });

  return bot;
}
