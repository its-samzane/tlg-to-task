import type { Bot } from 'grammy';
import { deactivateChat, registerChat } from '../../services/chats.js';
import type { AppContext } from '../context.js';
import { isGroupChat, isOwner, replyHtml } from '../util.js';

export function registerRegistrationCommands(bot: Bot<AppContext>): void {
  bot.command('register', async (ctx) => {
    if (!isGroupChat(ctx.chat)) {
      await replyHtml(ctx, ctx.t('errors.groupOnly'));
      return;
    }
    if (!isOwner(ctx)) {
      await replyHtml(ctx, ctx.t('errors.ownerOnly'));
      return;
    }
    const result = await registerChat(ctx.deps.db, {
      chatId: ctx.chat.id,
      title: 'title' in ctx.chat ? (ctx.chat.title ?? null) : null,
      userId: ctx.from!.id,
    });
    if (result.created || result.reactivated) {
      ctx.deps.logger.info({ chatId: ctx.chat.id }, 'Group registered');
      await replyHtml(ctx, ctx.t('register.success'));
    } else {
      await replyHtml(ctx, ctx.t('register.already'));
    }
  });

  bot.command('unregister', async (ctx) => {
    if (!isGroupChat(ctx.chat)) {
      await replyHtml(ctx, ctx.t('errors.groupOnly'));
      return;
    }
    if (!isOwner(ctx)) {
      await replyHtml(ctx, ctx.t('errors.ownerOnly'));
      return;
    }
    const deactivated = await deactivateChat(ctx.deps.db, ctx.chat.id);
    if (deactivated) {
      ctx.deps.logger.info({ chatId: ctx.chat.id }, 'Group deactivated');
      await replyHtml(ctx, ctx.t('unregister.success'));
    } else {
      await replyHtml(ctx, ctx.t('errors.notRegistered'));
    }
  });
}
