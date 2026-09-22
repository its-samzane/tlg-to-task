import type { Chat, Message, User } from 'grammy/types';
import type { AppContext } from './context.js';

export function isGroupChat(chat: Chat | undefined): boolean {
  return chat?.type === 'group' || chat?.type === 'supergroup';
}

export function isOwner(ctx: AppContext): boolean {
  return ctx.from?.id === ctx.deps.config.OWNER_TELEGRAM_ID;
}

export function userDisplayName(user: User): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || (user.username ? `@${user.username}` : String(user.id));
}

/** Name of the author of a message: the user, or the channel/group for anonymous senders. */
export function senderName(message: Message): string {
  if (message.sender_chat?.title) return message.sender_chat.title;
  if (message.from) return userDisplayName(message.from);
  return 'Unknown';
}

export function senderId(message: Message): number {
  return message.from?.id ?? message.sender_chat?.id ?? 0;
}

/** True when the message is a bot command such as "/new" or "/new@my_bot". */
export function isCommandMessage(message: Message): boolean {
  const entity = message.entities?.[0];
  return entity?.type === 'bot_command' && entity.offset === 0;
}

export function replyHtml(
  ctx: AppContext,
  text: string,
  extra: Parameters<AppContext['reply']>[1] = {},
): ReturnType<AppContext['reply']> {
  return ctx.reply(text, { parse_mode: 'HTML', ...extra });
}

/** Parses "12" or "#12" from a command argument. */
export function parseTaskNumber(argument: string | undefined): number | undefined {
  const match = argument?.trim().match(/^#?(\d{1,9})$/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Checks that the command was sent in a registered group. Sends the matching explanation and
 * returns false otherwise.
 */
export async function requireActiveGroup(ctx: AppContext): Promise<boolean> {
  if (!isGroupChat(ctx.chat)) {
    await replyHtml(ctx, ctx.t('errors.groupOnly'));
    return false;
  }
  if (!ctx.chatRecord) {
    await replyHtml(ctx, ctx.t('errors.notRegistered'));
    return false;
  }
  return true;
}
