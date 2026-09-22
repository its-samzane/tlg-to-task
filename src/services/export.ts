import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import type { Chat, Message, Task } from '../db/schema.js';
import type { I18n } from '../i18n.js';
import type { FileStore } from './files.js';

export interface ExportInput {
  task: Task;
  chat: Chat;
  messages: Message[];
  i18n: I18n;
}

/** Telegram bots may upload files up to 50 MB. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const ATTACHMENTS_DIR = 'attachments';

export function attachmentPath(message: Message): string | undefined {
  if (!message.filePath) return undefined;
  return `${ATTACHMENTS_DIR}/${path.basename(message.filePath)}`;
}

/** Percent-encodes a relative path for use inside a Markdown link. */
function linkTarget(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/');
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Prevents message text from being parsed as Markdown structure (headings, quotes, code fences). */
function escapeTextBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\s*(#|>|```|~~~)/.test(line) ? `\\${line.trimStart()}` : line))
    .join('\n');
}

function kindLabel(message: Message, t: I18n['t']): string | undefined {
  switch (message.kind) {
    case 'voice':
      return `🎤 ${t.raw('export.kind.voice')}${duration(message)}`;
    case 'audio':
      return `🎵 ${t.raw('export.kind.audio')}${duration(message)}`;
    case 'photo':
      return `🖼 ${t.raw('export.kind.photo')}`;
    case 'video':
      return `🎬 ${t.raw('export.kind.video')}${duration(message)}`;
    case 'video_note':
      return `🎬 ${t.raw('export.kind.videoNote')}${duration(message)}`;
    case 'document':
      return `📎 ${t.raw('export.kind.file')}`;
    case 'sticker':
      return `🩹 ${t.raw('export.kind.sticker')}`;
    case 'other':
      return `📍 ${t.raw('export.kind.other')}`;
    default:
      return undefined;
  }
}

function duration(message: Message): string {
  const formatted = formatDuration(message.durationSeconds);
  return formatted ? ` (${formatted})` : '';
}

function renderAttachmentReference(message: Message, t: I18n['t']): string | undefined {
  const relative = attachmentPath(message);
  if (!relative) {
    return message.telegramFileId ? `_${t.raw('export.fileMissing')}_` : undefined;
  }
  const name = path.basename(relative);
  if (message.kind === 'photo') return `![${name}](${linkTarget(relative)})`;
  const details = [message.mimeType, formatBytes(message.fileSize)].filter(Boolean).join(', ');
  return `[${name}](${linkTarget(relative)})${details ? ` (${details})` : ''}`;
}

export function renderMarkdown(input: ExportInput): string {
  const { task, chat, messages, i18n } = input;
  const t = i18n.t;
  const title = task.title ?? t.raw('task.untitled', { number: task.number });
  const attachments = messages.filter((message) => message.filePath);
  const lines: string[] = [];

  lines.push(`# #${task.number} — ${title}`, '');
  const statusLabel = t.raw(task.status === 'done' ? 'export.statusDone' : 'export.statusOpen');
  lines.push(`- **${t.raw('export.status')}:** ${statusLabel}`);
  if (chat.title) lines.push(`- **${t.raw('export.group')}:** ${chat.title}`);
  lines.push(`- **${t.raw('export.createdBy')}:** ${task.createdByName}`);
  lines.push(`- **${t.raw('export.created')}:** ${i18n.formatDateTime(task.createdAt)}`);
  if (task.closedAt) {
    lines.push(`- **${t.raw('export.finished')}:** ${i18n.formatDateTime(task.closedAt)}`);
  }
  if (task.editRound > 0) {
    lines.push(`- **${t.raw('export.updated')}:** ${i18n.formatDateTime(task.updatedAt)}`);
  }
  if (task.doneAt)
    lines.push(`- **${t.raw('export.doneAt')}:** ${i18n.formatDateTime(task.doneAt)}`);
  lines.push(
    `- **${t.raw('export.messages')}:** ${messages.length} · **${t.raw('export.attachments')}:** ${attachments.length}`,
    '',
  );

  lines.push(`## ${t.raw('export.conversation')}`, '');
  let currentDay: string | undefined;
  let currentRound = 0;
  for (const message of messages) {
    if (message.editRound !== currentRound) {
      currentRound = message.editRound;
      currentDay = undefined;
      lines.push(
        `### ${t.raw('export.addedLater', { date: i18n.formatDate(message.sentAt) })}`,
        '',
      );
    }
    const day = i18n.formatDate(message.sentAt);
    if (day !== currentDay) {
      currentDay = day;
      lines.push(`### ${day}`, '');
    }
    const header = [
      `**${message.fromName}**`,
      i18n.formatTime(message.sentAt),
      kindLabel(message, t),
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(header);
    const reference = renderAttachmentReference(message, t);
    if (reference) lines.push(reference);
    if (message.text) lines.push(escapeTextBlock(message.text));
    if (message.kind === 'voice' || message.kind === 'audio') {
      if (message.transcript) {
        lines.push(escapeTextBlock(message.transcript));
      } else if (
        message.transcriptionStatus === 'failed' ||
        message.transcriptionStatus === 'skipped'
      ) {
        lines.push(`_${t.raw('export.notTranscribed')}_`);
      }
    }
    lines.push('');
  }

  if (attachments.length > 0) {
    lines.push(`## ${t.raw('export.attachments')}`, '');
    for (const message of attachments) {
      const relative = attachmentPath(message)!;
      const details = [
        kindLabel(message, t)?.replace(/^\S+\s/, ''),
        formatBytes(message.fileSize),
        message.fromName,
        i18n.formatDateTime(message.sentAt),
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(`- [${path.basename(relative)}](${linkTarget(relative)}) — ${details}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildTaskJson(input: ExportInput): Record<string, unknown> {
  const { task, chat, messages, i18n } = input;
  return {
    number: task.number,
    title: task.title,
    status: task.status,
    language: i18n.language,
    group: { id: chat.chatId, title: chat.title },
    createdBy: { id: task.createdByUserId, name: task.createdByName },
    createdAt: task.createdAt.toISOString(),
    finishedAt: task.closedAt?.toISOString() ?? null,
    updatedAt: task.updatedAt.toISOString(),
    doneAt: task.doneAt?.toISOString() ?? null,
    editRounds: task.editRound,
    messages: messages.map((message) => ({
      id: message.id,
      telegramMessageId: message.telegramMessageId,
      from: { id: message.fromUserId, name: message.fromName },
      kind: message.kind,
      text: message.text,
      transcript: message.transcript,
      transcriptionStatus: message.transcriptionStatus,
      sentAt: message.sentAt.toISOString(),
      editRound: message.editRound,
      attachment: message.filePath
        ? {
            path: attachmentPath(message),
            fileName: message.fileName,
            mimeType: message.mimeType,
            size: message.fileSize,
            durationSeconds: message.durationSeconds,
          }
        : null,
    })),
    exportedAt: new Date().toISOString(),
  };
}

export interface ZipResult {
  /** Absolute path of the temporary zip file. Call `cleanup()` when done. */
  path: string;
  fileName: string;
  size: number;
  /** Attachments that were not included (missing on disk or deliberately skipped). */
  skipped: string[];
  cleanup(): Promise<void>;
}

export interface BuildZipOptions {
  /** Set to false to produce a zip with only the Markdown and JSON files. */
  includeAttachments?: boolean;
}

export async function buildZip(
  input: ExportInput,
  files: FileStore,
  options: BuildZipOptions = {},
): Promise<ZipResult> {
  const includeAttachments = options.includeAttachments ?? true;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tlg-export-'));
  const fileName = `task-${input.task.number}.zip`;
  const zipPath = path.join(dir, fileName);
  const skipped: string[] = [];

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(zipPath);
  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);

  archive.append(renderMarkdown(input), { name: `task-${input.task.number}.md` });
  archive.append(JSON.stringify(buildTaskJson(input), null, 2), { name: 'task.json' });

  for (const message of input.messages) {
    const relative = attachmentPath(message);
    if (!relative || !message.filePath) continue;
    if (!includeAttachments) {
      skipped.push(path.basename(relative));
      continue;
    }
    const absolute = files.absolutePath(message.filePath);
    try {
      await stat(absolute);
      archive.file(absolute, { name: relative });
    } catch {
      skipped.push(path.basename(relative));
    }
  }

  await archive.finalize();
  await finished;
  const { size } = await stat(zipPath);
  return {
    path: zipPath,
    fileName,
    size,
    skipped,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
