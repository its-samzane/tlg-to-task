import type { Bot } from 'grammy';
import type { AppContext } from '../context.js';
import { isGroupChat, replyHtml } from '../util.js';
import { buildHelpText } from './menu.js';

export function registerBasicCommands(bot: Bot<AppContext>): void {
  bot.command('start', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await replyHtml(ctx, ctx.t('start.private', { userId: ctx.from?.id ?? '' }));
      return;
    }
    await replyHtml(ctx, buildHelpText(ctx.t, 'group'));
  });

  bot.command('help', async (ctx) => {
    await replyHtml(ctx, buildHelpText(ctx.t, isGroupChat(ctx.chat) ? 'group' : 'private'));
  });

  bot.command('id', async (ctx) => {
    await replyHtml(ctx, ctx.t('id.text', { userId: ctx.from?.id ?? '', chatId: ctx.chat.id }));
  });
}
