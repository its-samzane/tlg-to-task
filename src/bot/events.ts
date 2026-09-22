import type { Bot } from 'grammy';
import { updateChatTitle } from '../services/chats.js';
import type { AppContext } from './context.js';
import { isGroupChat } from './util.js';

const ABSENT = new Set(['left', 'kicked']);
const PRESENT = new Set(['member', 'administrator', 'restricted']);

export function registerEvents(bot: Bot<AppContext>): void {
  // The bot was added to a group: explain how to activate it.
  bot.on('my_chat_member', async (ctx) => {
    const update = ctx.myChatMember;
    if (!isGroupChat(update.chat)) return;
    const wasAbsent = ABSENT.has(update.old_chat_member.status);
    const isPresent = PRESENT.has(update.new_chat_member.status);
    if (wasAbsent && isPresent && !ctx.chatRecord) {
      try {
        await ctx.api.sendMessage(update.chat.id, ctx.t('joined.hint'), { parse_mode: 'HTML' });
      } catch (error) {
        ctx.deps.logger.debug({ err: error }, 'Could not send join hint');
      }
    }
  });

  // Keep the stored group title in sync (it is shown in exports).
  bot.on('message:new_chat_title', async (ctx) => {
    if (ctx.chatRecord) {
      await updateChatTitle(ctx.deps.db, ctx.chat.id, ctx.message.new_chat_title);
    }
  });

  // Other service messages are never captured into tasks.
  bot.on(
    [
      'message:new_chat_members',
      'message:left_chat_member',
      'message:new_chat_photo',
      'message:delete_chat_photo',
      'message:pinned_message',
      'message:group_chat_created',
      'message:supergroup_chat_created',
      'message:migrate_to_chat_id',
      'message:migrate_from_chat_id',
    ],
    async () => undefined,
  );
}
