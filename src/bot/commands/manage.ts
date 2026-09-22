import { InlineKeyboard, type Bot } from 'grammy';
import type { Task } from '../../db/schema.js';
import {
  deleteTask,
  getTaskById,
  getTaskByNumber,
  listTasks,
  setTaskStatus,
} from '../../services/tasks.js';
import { escapeHtml } from '../../util/html.js';
import type { AppContext } from '../context.js';
import { isOwner, parseTaskNumber, replyHtml, requireActiveGroup } from '../util.js';

/** Telegram allows 4096 characters per message; stay well below to leave room for HTML tags. */
const MAX_MESSAGE_LENGTH = 3500;

export const DELETE_CALLBACK_PATTERN = /^task:delete:(confirm|keep):(\d+):(\d+)$/;

export function statusIcon(task: Task): string {
  if (task.captureState !== 'none') return '🎙';
  return task.status === 'done' ? '✅' : '⬜';
}

export function formatTaskLine(task: Task, t: AppContext['t']): string {
  const title =
    task.captureState !== 'none' && !task.title
      ? t('list.recording')
      : escapeHtml(task.title ?? t.raw('task.untitled', { number: task.number }));
  return `${statusIcon(task)} <b>#${task.number}</b> ${title}`;
}

/** Splits lines into messages that fit Telegram's size limit. */
export function chunkLines(lines: string[], maxLength = MAX_MESSAGE_LENGTH): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const candidate = current === '' ? line : `${current}\n${line}`;
    if (candidate.length > maxLength && current !== '') {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/**
 * Resolves the task addressed by a command argument ("/done 12"). Replies with the matching
 * error and returns undefined when the argument is missing, unknown or still recording.
 */
export async function resolveTaskArgument(
  ctx: AppContext,
  command: string,
  options: { allowRecording?: boolean } = {},
): Promise<Task | undefined> {
  const number = parseTaskNumber(typeof ctx.match === 'string' ? ctx.match : undefined);
  if (number === undefined) {
    await replyHtml(ctx, ctx.t('errors.usageNumber', { command }));
    return undefined;
  }
  const task = await getTaskByNumber(ctx.deps.db, ctx.chat!.id, number);
  if (!task) {
    await replyHtml(ctx, ctx.t('errors.taskNotFound', { number }));
    return undefined;
  }
  if (task.captureState !== 'none' && !options.allowRecording) {
    await replyHtml(ctx, ctx.t('errors.taskRecording', { number }));
    return undefined;
  }
  return task;
}

export function canDelete(ctx: AppContext): boolean {
  return isOwner(ctx) || ctx.deps.config.ALLOW_MEMBER_DELETE;
}

export function registerManagementCommands(bot: Bot<AppContext>): void {
  bot.command('list', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    const all = await listTasks(ctx.deps.db, ctx.chat.id);
    if (all.length === 0) {
      await replyHtml(ctx, ctx.t('list.empty'));
      return;
    }
    const done = all.filter((task) => task.status === 'done' && task.captureState === 'none');
    const header = ctx.t('list.header', {
      total: all.length,
      open: all.length - done.length,
      done: done.length,
    });
    const lines = all.map((task) => formatTaskLine(task, ctx.t));
    for (const chunk of chunkLines([header, '', ...lines])) {
      await replyHtml(ctx, chunk);
    }
  });

  bot.command('done', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    const task = await resolveTaskArgument(ctx, 'done');
    if (!task) return;
    if (task.status === 'done') {
      await replyHtml(ctx, ctx.t('status.alreadyDone', { number: task.number }));
      return;
    }
    const updated = await setTaskStatus(ctx.deps.db, task.id, 'done');
    await replyHtml(
      ctx,
      ctx.t('status.done', { number: task.number, title: updated?.title ?? '' }),
    );
  });

  bot.command('undone', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    const task = await resolveTaskArgument(ctx, 'undone');
    if (!task) return;
    if (task.status === 'open') {
      await replyHtml(ctx, ctx.t('status.alreadyOpen', { number: task.number }));
      return;
    }
    const updated = await setTaskStatus(ctx.deps.db, task.id, 'open');
    await replyHtml(
      ctx,
      ctx.t('status.undone', { number: task.number, title: updated?.title ?? '' }),
    );
  });

  bot.command('delete', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    if (!canDelete(ctx)) {
      await replyHtml(ctx, ctx.t('errors.ownerOnly'));
      return;
    }
    const task = await resolveTaskArgument(ctx, 'delete');
    if (!task) return;
    const requester = ctx.from?.id ?? 0;
    const keyboard = new InlineKeyboard()
      .text(ctx.t.raw('buttons.confirmDelete'), `task:delete:confirm:${task.id}:${requester}`)
      .text(ctx.t.raw('buttons.keep'), `task:delete:keep:${task.id}:${requester}`);
    await replyHtml(
      ctx,
      ctx.t('delete.confirm', { number: task.number, title: task.title ?? '' }),
      { reply_markup: keyboard },
    );
  });

  bot.callbackQuery(DELETE_CALLBACK_PATTERN, async (ctx) => {
    const action = ctx.match[1];
    const taskId = Number(ctx.match[2]);
    const requester = Number(ctx.match[3]);
    const presser = ctx.from.id;
    if (presser !== requester && !isOwner(ctx)) {
      await ctx.answerCallbackQuery({ text: ctx.t.raw('callback.notYours'), show_alert: true });
      return;
    }
    const task = await getTaskById(ctx.deps.db, taskId);
    if (!task || !ctx.chatRecord || task.chatId !== ctx.chatRecord.chatId) {
      await ctx.answerCallbackQuery({ text: ctx.t.raw('callback.gone') });
      await editSafely(ctx, ctx.t('callback.gone'));
      return;
    }
    await ctx.answerCallbackQuery();
    if (action === 'keep') {
      await editSafely(ctx, ctx.t('delete.kept', { number: task.number }));
      return;
    }
    if (task.captureState !== 'none') {
      await editSafely(ctx, ctx.t('errors.taskRecording', { number: task.number }));
      return;
    }
    await deleteTask(ctx.deps.db, task.id);
    await ctx.deps.files.removeTask(task.id);
    ctx.deps.logger.info({ taskId: task.id, number: task.number, by: presser }, 'Task deleted');
    await editSafely(ctx, ctx.t('delete.done', { number: task.number }));
  });
}

async function editSafely(ctx: AppContext, text: string): Promise<void> {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML' });
  } catch (error) {
    ctx.deps.logger.debug({ err: error }, 'Could not edit confirmation message');
  }
}
