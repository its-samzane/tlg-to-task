import { InputFile, type Bot } from 'grammy';
import { listMessages } from '../../services/messages.js';
import { buildZip, MAX_UPLOAD_BYTES } from '../../services/export.js';
import { escapeHtml } from '../../util/html.js';
import type { AppContext } from '../context.js';
import { replyHtml, requireActiveGroup } from '../util.js';
import { resolveTaskArgument } from './manage.js';

export function registerShowCommand(bot: Bot<AppContext>): void {
  bot.command('show', async (ctx) => {
    if (!(await requireActiveGroup(ctx))) return;
    const task = await resolveTaskArgument(ctx, 'show');
    if (!task) return;
    const { db, files, i18n, logger } = ctx.deps;

    await ctx.replyWithChatAction('upload_document');
    const messages = await listMessages(db, task.id);
    const input = { task, chat: ctx.chatRecord!, messages, i18n };

    let zip = await buildZip(input, files);
    let attachmentsLeftOut = false;
    if (zip.size > MAX_UPLOAD_BYTES) {
      await zip.cleanup();
      zip = await buildZip(input, files, { includeAttachments: false });
      attachmentsLeftOut = true;
    }

    try {
      const title = escapeHtml(task.title ?? i18n.t.raw('task.untitled', { number: task.number }));
      await ctx.replyWithDocument(new InputFile(zip.path, zip.fileName), {
        caption: `#${task.number} <b>${title}</b>`,
        parse_mode: 'HTML',
      });
      if (attachmentsLeftOut) {
        await replyHtml(ctx, ctx.t('export.attachmentsLeftOut'));
      } else if (zip.skipped.length > 0) {
        await replyHtml(ctx, ctx.t('export.someFilesMissing', { files: zip.skipped.join(', ') }));
      }
      logger.info({ taskId: task.id, size: zip.size }, 'Task exported');
    } finally {
      await zip.cleanup();
    }
  });
}
