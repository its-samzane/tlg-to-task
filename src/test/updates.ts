import type { Chat, Message, Update, User } from 'grammy/types';
import { OWNER_ID } from './bot.js';

export const OWNER: User = { id: OWNER_ID, is_bot: false, first_name: 'Sam' };
export const CLIENT: User = { id: 200, is_bot: false, first_name: 'Ali', last_name: 'Client' };
export const GROUP: Chat.SupergroupChat = { id: -1001, type: 'supergroup', title: 'Project X' };
export const PRIVATE: Chat.PrivateChat = { id: OWNER_ID, type: 'private', first_name: 'Sam' };

let updateId = 1;
let messageId = 1;
let now = 1_800_000_000;

interface MessageOptions {
  from?: User;
  chat?: Chat;
}

function baseMessage(options: MessageOptions): Message {
  messageId += 1;
  now += 1;
  return {
    message_id: messageId,
    date: now,
    chat: options.chat ?? GROUP,
    from: options.from ?? CLIENT,
  } as Message;
}

function wrap(message: Message): Update {
  updateId += 1;
  return { update_id: updateId, message };
}

export function textMessage(text: string, options: MessageOptions = {}): Update {
  const message = baseMessage(options) as Message.TextMessage;
  message.text = text;
  if (text.startsWith('/')) {
    message.entities = [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }];
  }
  return wrap(message);
}

export function voiceMessage(
  options: MessageOptions & { fileId?: string; duration?: number } = {},
): Update {
  const message = baseMessage(options) as Message.VoiceMessage;
  message.voice = {
    file_id: options.fileId ?? 'voice-1',
    file_unique_id: 'u-voice',
    duration: options.duration ?? 7,
    mime_type: 'audio/ogg',
    file_size: 4321,
  };
  return wrap(message);
}

export function photoMessage(
  options: MessageOptions & { fileId?: string; caption?: string } = {},
): Update {
  const message = baseMessage(options) as Message.PhotoMessage;
  message.photo = [
    { file_id: 'small', file_unique_id: 'u-small', width: 90, height: 90, file_size: 100 },
    {
      file_id: options.fileId ?? 'photo-1',
      file_unique_id: 'u-large',
      width: 1280,
      height: 960,
      file_size: 90000,
    },
  ];
  if (options.caption) message.caption = options.caption;
  return wrap(message);
}

export function documentMessage(
  options: MessageOptions & { fileId?: string; fileName?: string } = {},
): Update {
  const message = baseMessage(options) as Message.DocumentMessage;
  message.document = {
    file_id: options.fileId ?? 'doc-1',
    file_unique_id: 'u-doc',
    file_name: options.fileName ?? 'spec.pdf',
    mime_type: 'application/pdf',
    file_size: 5000,
  };
  return wrap(message);
}

export function callbackQuery(
  data: string,
  options: MessageOptions & { messageId?: number } = {},
): Update {
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from: options.from ?? CLIENT,
      chat_instance: 'instance',
      data,
      message: {
        message_id: options.messageId ?? 1,
        date: now,
        chat: options.chat ?? GROUP,
        text: 'control message',
      },
    },
  };
}
