import { InlineKeyboard, type Bot } from 'grammy';
import type { Message, Task } from '../db/schema.js';
import { TaskAlreadyRecordingError } from '../services/errors.js';
import { firstTextLine, listMessages } from '../services/messages.js';
import {
  cancelTask,
  finishTask,
  getCapturingTask,
  getTaskById,
  setControlMessage,
  startEdit,
  startTask,
} from '../services/tasks.js';
import { resolveTaskArgument } from './commands/manage.js';
import type { AppContext, Deps } from './context.js';
import { replyHtml, requireActiveGroup, userDisplayName } from './util.js';

export const CALLBACK_PATTERN = /^task:(finish|cancel):(\d+)$/;

export function controlKeyboard(t: AppContext['t'], taskId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t.raw('buttons.finish'), `task:finish:${taskId}`)
    .text(t.raw('buttons.cancel'), `task:cancel:${taskId}`);
}

/** Tasks whose finish/cancel is in progress, so two people pressing a button at once do not race. */
const closing = new Set<number>();

export function registerRecordingCommands(bot: Bot<AppContext>): void {
  bot.command('new', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    await startRecording(ctx);
  });

  bot.command('edit', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    const task = await resolveTaskArgument(ctx, 'edit');
    if (!task) return;
    await startEditing(ctx, task);
  });

  bot.command('end', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    const task = await getCapturingTask(ctx.deps.db, ctx.chat.id);
    if (!task) {
      await replyHtml(ctx, ctx.t('task.noneRecording'));
      return;
    }
    await finishRecording(ctx, task);
  });

  bot.command('cancel', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    const task = await getCapturingTask(ctx.deps.db, ctx.chat.id);
    if (!task) {
      await replyHtml(ctx, ctx.t('task.noneRecording'));
      return;
    }
    await cancelRecording(ctx, task);
  });

  bot.callbackQuery(CALLBACK_PATTERN, async (ctx) => {
    const action = ctx.match[1];
    const taskId = Number(ctx.match[2]);
    const task = await getTaskById(ctx.deps.db, taskId);
    const usable =
      task &&
      task.captureState !== 'none' &&
      ctx.chatRecord &&
      task.chatId === ctx.chatRecord.chatId;
    if (!usable) {
      await ctx.answerCallbackQuery({ text: ctx.t.raw('callback.stale') });
      return;
    }
    await ctx.answerCallbackQuery();
    if (action === 'finish') {
      await finishRecording(ctx, task);
    } else {
      await cancelRecording(ctx, task);
    }
  });
}

export async function startRecording(ctx: AppContext): Promise<void> {
  const chatId = ctx.chat!.id;
  try {
    const task = await startTask(ctx.deps.db, {
      chatId,
      userId: ctx.from?.id ?? 0,
      userName: ctx.from ? userDisplayName(ctx.from) : 'Unknown',
    });
    const control = await replyHtml(ctx, ctx.t('task.recordingStarted', { number: task.number }), {
      reply_markup: controlKeyboard(ctx.t, task.id),
    });
    await setControlMessage(ctx.deps.db, task.id, control.message_id);
    ctx.deps.logger.info({ chatId, taskId: task.id, number: task.number }, 'Recording started');
  } catch (error) {
    if (error instanceof TaskAlreadyRecordingError) {
      await replyHtml(ctx, ctx.t('task.alreadyRecording', { number: error.task.number }));
      return;
    }
    throw error;
  }
}

export async function startEditing(ctx: AppContext, task: Task): Promise<void> {
  try {
    const editing = await startEdit(ctx.deps.db, task);
    const control = await replyHtml(
      ctx,
      ctx.t('task.editStarted', { number: editing.number, title: editing.title ?? '' }),
      { reply_markup: controlKeyboard(ctx.t, editing.id) },
    );
    await setControlMessage(ctx.deps.db, editing.id, control.message_id);
    ctx.deps.logger.info(
      { taskId: editing.id, number: editing.number, round: editing.editRound },
      'Editing started',
    );
  } catch (error) {
    if (error instanceof TaskAlreadyRecordingError) {
      await replyHtml(ctx, ctx.t('task.alreadyRecording', { number: error.task.number }));
      return;
    }
    throw error;
  }
}

async function generateTitle(deps: Deps, list: Message[]): Promise<string | undefined> {
  if (!deps.titles) return undefined;
  try {
    const title = await deps.titles.generateTitle({
      messages: list,
      language: deps.i18n.language,
      languageName: deps.i18n.meta.englishName,
    });
    return title?.trim() || undefined;
  } catch (error) {
    deps.logger.warn({ err: error }, 'Title generation failed, using fallback title');
    return undefined;
  }
}

/** Replaces the control message text and removes its buttons. Ignores a deleted message. */
async function updateControlMessage(ctx: AppContext, task: Task, text: string): Promise<void> {
  if (!task.controlMessageId) return;
  try {
    await ctx.api.editMessageText(task.chatId, task.controlMessageId, text, { parse_mode: 'HTML' });
  } catch (error) {
    ctx.deps.logger.debug({ err: error, taskId: task.id }, 'Could not update control message');
  }
}

export async function finishRecording(ctx: AppContext, task: Task): Promise<void> {
  if (closing.has(task.id)) return;
  closing.add(task.id);
  try {
    const { db, files, pending, logger } = ctx.deps;
    const number = task.number;
    await pending.wait(task.id);
    const list = await listMessages(db, task.id);
    const roundMessages = list.filter((message) => message.editRound === task.editRound);

    if (task.captureState === 'new' && list.length === 0) {
      await cancelTask(db, task);
      await files.removeTask(task.id);
      await updateControlMessage(ctx, task, ctx.t('task.cancelledControl', { number }));
      await replyHtml(ctx, ctx.t('task.emptyDiscarded', { number }));
      logger.info({ taskId: task.id }, 'Empty task discarded');
      return;
    }
    if (task.captureState === 'edit' && roundMessages.length === 0) {
      await finishTask(db, task.id);
      await updateControlMessage(ctx, task, ctx.t('task.recordingFinishedControl', { number }));
      await replyHtml(ctx, ctx.t('task.editNothingAdded', { number }));
      logger.info({ taskId: task.id }, 'Edit round finished without additions');
      return;
    }

    let title = task.title ?? undefined;
    if (task.captureState === 'new') {
      title =
        (await generateTitle(ctx.deps, list)) ??
        firstTextLine(list) ??
        ctx.t.raw('task.untitled', { number });
    }
    const finished = await finishTask(db, task.id, title);
    await updateControlMessage(ctx, task, ctx.t('task.recordingFinishedControl', { number }));
    const key = task.captureState === 'new' ? 'task.finished' : 'task.updated';
    await replyHtml(
      ctx,
      ctx.t(key, {
        number,
        title: finished.title ?? '',
        count: task.captureState === 'new' ? list.length : roundMessages.length,
      }),
    );
    logger.info({ taskId: task.id, number, messages: list.length }, 'Recording finished');
  } finally {
    closing.delete(task.id);
  }
}

export async function cancelRecording(ctx: AppContext, task: Task): Promise<void> {
  if (closing.has(task.id)) return;
  closing.add(task.id);
  try {
    const { db, files, pending, logger } = ctx.deps;
    await pending.wait(task.id);
    const result = await cancelTask(db, task);
    if (result.deleted) {
      await files.removeTask(task.id);
    } else {
      await files.removeFiles(
        result.removedMessages
          .map((message) => message.filePath)
          .filter((filePath): filePath is string => filePath !== null),
      );
    }
    await updateControlMessage(ctx, task, ctx.t('task.cancelledControl', { number: task.number }));
    await replyHtml(
      ctx,
      ctx.t(result.deleted ? 'task.cancelled' : 'task.editCancelled', { number: task.number }),
    );
    logger.info({ taskId: task.id, deleted: result.deleted }, 'Recording cancelled');
  } finally {
    closing.delete(task.id);
  }
}
