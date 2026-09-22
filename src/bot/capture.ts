import type { Bot } from 'grammy';
import type { Message as TelegramMessage } from 'grammy/types';
import type { Message, NewMessage, Task } from '../db/schema.js';
import { FileTooBigError } from '../services/errors.js';
import { splitExtension, type SavedFile } from '../services/files.js';
import { addMessage, nextAttachmentIndex, setTranscription } from '../services/messages.js';
import { getCapturingTask } from '../services/tasks.js';
import type { AppContext, Deps } from './context.js';
import { isCommandMessage, isGroupChat, senderId, senderName } from './util.js';

interface Classified {
  kind: Message['kind'];
  text?: string;
  fileId?: string;
  baseName?: string;
  extension?: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  durationSeconds?: number;
}

/** Maps a Telegram message onto the stored representation. Returns undefined for unsupported types. */
export function classifyMessage(message: TelegramMessage): Classified | undefined {
  const caption = message.caption;
  if (message.text !== undefined) return { kind: 'text', text: message.text };
  if (message.voice) {
    return {
      kind: 'voice',
      text: caption,
      fileId: message.voice.file_id,
      baseName: 'voice',
      mimeType: message.voice.mime_type,
      fileSize: message.voice.file_size,
      durationSeconds: message.voice.duration,
    };
  }
  if (message.audio) {
    const { base, extension } = splitExtension(message.audio.file_name ?? '');
    return {
      kind: 'audio',
      text: caption,
      fileId: message.audio.file_id,
      baseName: base || 'audio',
      extension: extension || undefined,
      originalFileName: message.audio.file_name,
      mimeType: message.audio.mime_type,
      fileSize: message.audio.file_size,
      durationSeconds: message.audio.duration,
    };
  }
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1]!;
    return {
      kind: 'photo',
      text: caption,
      fileId: largest.file_id,
      baseName: 'photo',
      extension: '.jpg',
      mimeType: 'image/jpeg',
      fileSize: largest.file_size,
    };
  }
  if (message.video) {
    const { base, extension } = splitExtension(message.video.file_name ?? '');
    return {
      kind: 'video',
      text: caption,
      fileId: message.video.file_id,
      baseName: base || 'video',
      extension: extension || undefined,
      originalFileName: message.video.file_name,
      mimeType: message.video.mime_type,
      fileSize: message.video.file_size,
      durationSeconds: message.video.duration,
    };
  }
  if (message.video_note) {
    return {
      kind: 'video_note',
      fileId: message.video_note.file_id,
      baseName: 'video-note',
      extension: '.mp4',
      mimeType: 'video/mp4',
      fileSize: message.video_note.file_size,
      durationSeconds: message.video_note.duration,
    };
  }
  if (message.document) {
    const { base, extension } = splitExtension(message.document.file_name ?? '');
    return {
      kind: 'document',
      text: caption,
      fileId: message.document.file_id,
      baseName: base || 'document',
      extension: extension || undefined,
      originalFileName: message.document.file_name,
      mimeType: message.document.mime_type,
      fileSize: message.document.file_size,
    };
  }
  if (message.sticker) return { kind: 'sticker', text: message.sticker.emoji };
  if (message.location) {
    return {
      kind: 'other',
      text: `${message.location.latitude}, ${message.location.longitude}`,
    };
  }
  if (message.contact) {
    const name = [message.contact.first_name, message.contact.last_name].filter(Boolean).join(' ');
    return { kind: 'other', text: `${name} ${message.contact.phone_number}`.trim() };
  }
  if (message.poll) return { kind: 'other', text: message.poll.question };
  return undefined;
}

export function registerCapture(bot: Bot<AppContext>): void {
  bot.on('message', async (ctx) => {
    if (!isGroupChat(ctx.chat) || !ctx.chatRecord) return;
    if (isCommandMessage(ctx.message)) return;
    const task = await getCapturingTask(ctx.deps.db, ctx.chat.id);
    if (!task) return;
    await captureMessage(ctx, task, ctx.message);
  });
}

export async function captureMessage(
  ctx: AppContext,
  task: Task,
  message: TelegramMessage,
): Promise<Message | undefined> {
  const { db, files, logger } = ctx.deps;
  const classified = classifyMessage(message);
  if (!classified) return undefined;

  let saved: SavedFile | undefined;
  let downloadProblem: 'tooBig' | 'failed' | undefined;
  if (classified.fileId) {
    try {
      const index = await nextAttachmentIndex(db, task.id);
      saved = await files.saveTelegramFile({
        fileId: classified.fileId,
        taskId: task.id,
        index,
        baseName: classified.baseName ?? classified.kind,
        extension: classified.extension,
      });
    } catch (error) {
      downloadProblem = error instanceof FileTooBigError ? 'tooBig' : 'failed';
      logger.warn(
        { err: error, taskId: task.id, messageId: message.message_id },
        'Attachment could not be downloaded',
      );
    }
  }

  const isSpeech = classified.kind === 'voice' || classified.kind === 'audio';
  const record: NewMessage = {
    taskId: task.id,
    telegramMessageId: message.message_id,
    fromUserId: senderId(message),
    fromName: senderName(message),
    kind: classified.kind,
    text: classified.text,
    telegramFileId: classified.fileId,
    filePath: saved?.relativePath,
    fileName: saved?.fileName ?? classified.originalFileName,
    mimeType: classified.mimeType,
    fileSize: saved?.size ?? classified.fileSize,
    durationSeconds: classified.durationSeconds,
    transcriptionStatus: !isSpeech
      ? 'none'
      : !saved
        ? 'failed'
        : ctx.deps.transcriber
          ? 'pending'
          : 'skipped',
    editRound: task.editRound,
    sentAt: new Date(message.date * 1000),
  };
  const stored = await addMessage(db, record);

  if (downloadProblem) {
    await ctx.reply(
      ctx.t(downloadProblem === 'tooBig' ? 'capture.fileTooBig' : 'capture.downloadFailed'),
      { parse_mode: 'HTML', reply_parameters: { message_id: message.message_id } },
    );
  }

  if (isSpeech && saved && ctx.deps.transcriber) {
    ctx.deps.pending.track(task.id, transcribeMessage(ctx, task, stored, saved));
  }
  return stored;
}

async function transcribeMessage(
  ctx: AppContext,
  task: Task,
  stored: Message,
  saved: SavedFile,
): Promise<void> {
  const deps: Deps = ctx.deps;
  try {
    const transcript = await deps.transcriber!.transcribe({
      absolutePath: deps.files.absolutePath(saved.relativePath),
      fileName: saved.fileName,
      mimeType: stored.mimeType ?? undefined,
    });
    await setTranscription(deps.db, stored.id, 'done', transcript);
  } catch (error) {
    deps.logger.warn({ err: error, messageId: stored.id }, 'Transcription failed');
    await setTranscription(deps.db, stored.id, 'failed');
    try {
      await ctx.api.sendMessage(task.chatId, ctx.t('capture.transcriptionFailed'), {
        parse_mode: 'HTML',
        reply_parameters: { message_id: stored.telegramMessageId },
      });
    } catch (notifyError) {
      deps.logger.debug({ err: notifyError }, 'Could not notify about failed transcription');
    }
  }
}
