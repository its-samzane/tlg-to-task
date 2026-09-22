import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Chat, Message, Task } from '../db/schema.js';
import { createI18n } from '../i18n.js';
import { buildTaskJson, buildZip, formatBytes, formatDuration, renderMarkdown } from './export.js';
import type { FileStore } from './files.js';

const chat: Chat = {
  chatId: -1001,
  title: 'Project X',
  registeredByUserId: 1,
  active: true,
  nextTaskNumber: 3,
  createdAt: new Date('2026-03-01T08:00:00Z'),
};

const task: Task = {
  id: 7,
  chatId: chat.chatId,
  number: 2,
  title: 'Fix the login page',
  status: 'done',
  captureState: 'none',
  editRound: 1,
  controlMessageId: null,
  createdByUserId: 200,
  createdByName: 'Ali Client',
  createdAt: new Date('2026-03-21T09:00:00Z'),
  closedAt: new Date('2026-03-21T09:20:00Z'),
  updatedAt: new Date('2026-03-23T10:00:00Z'),
  doneAt: new Date('2026-03-24T11:00:00Z'),
};

function message(partial: Partial<Message> & { id: number }): Message {
  return {
    taskId: task.id,
    telegramMessageId: partial.id,
    fromUserId: 200,
    fromName: 'Ali Client',
    kind: 'text',
    text: null,
    transcript: null,
    transcriptionStatus: 'none',
    telegramFileId: null,
    filePath: null,
    fileName: null,
    mimeType: null,
    fileSize: null,
    durationSeconds: null,
    editRound: 0,
    sentAt: new Date('2026-03-21T09:05:00Z'),
    createdAt: new Date('2026-03-21T09:05:00Z'),
    ...partial,
  };
}

const messages: Message[] = [
  message({ id: 1, text: '# The login page is broken\nSecond line' }),
  message({
    id: 2,
    fromName: 'Sam',
    fromUserId: 100,
    kind: 'photo',
    text: 'screenshot',
    filePath: 'tasks/7/001-photo.jpg',
    fileName: '001-photo.jpg',
    mimeType: 'image/jpeg',
    fileSize: 90000,
    telegramFileId: 'p',
    sentAt: new Date('2026-03-21T09:06:00Z'),
  }),
  message({
    id: 3,
    kind: 'voice',
    transcript: 'Please fix it today',
    transcriptionStatus: 'done',
    filePath: 'tasks/7/002-voice.oga',
    fileName: '002-voice.oga',
    mimeType: 'audio/ogg',
    fileSize: 4321,
    durationSeconds: 67,
    telegramFileId: 'v',
    sentAt: new Date('2026-03-21T09:07:00Z'),
  }),
  message({
    id: 4,
    kind: 'document',
    filePath: 'tasks/7/003-spec v2.pdf',
    fileName: '003-spec v2.pdf',
    mimeType: 'application/pdf',
    fileSize: 5000,
    telegramFileId: 'd',
    sentAt: new Date('2026-03-21T09:08:00Z'),
  }),
  message({
    id: 5,
    kind: 'video',
    telegramFileId: 'too-big',
    transcriptionStatus: 'none',
    sentAt: new Date('2026-03-21T09:09:00Z'),
  }),
  message({
    id: 6,
    text: 'Also check the footer',
    editRound: 1,
    sentAt: new Date('2026-03-23T09:55:00Z'),
  }),
];

describe('renderMarkdown', () => {
  it('renders metadata, conversation and attachments in English', async () => {
    const i18n = await createI18n({ language: 'en', timeZone: 'UTC' });
    const md = renderMarkdown({ task, chat, messages, i18n });
    expect(md).toContain('# #2 — Fix the login page');
    expect(md).toContain('- **Status:** Done');
    expect(md).toContain('- **Group:** Project X');
    expect(md).toContain('- **Created by:** Ali Client');
    expect(md).toContain('- **Messages:** 6 · **Attachments:** 3');
    expect(md).toContain('### Mar 21, 2026');
    expect(md).toContain('**Ali Client** · 9:05 AM');
    expect(md).toContain('\\# The login page is broken\nSecond line');
    expect(md).toContain(
      '**Sam** · 9:06 AM · 🖼 photo\n![001-photo.jpg](attachments/001-photo.jpg)\nscreenshot',
    );
    expect(md).toContain('🎤 voice message (1:07)');
    expect(md).toContain(
      '[002-voice.oga](attachments/002-voice.oga) (audio/ogg, 4 KB)\nPlease fix it today',
    );
    expect(md).toContain('[003-spec v2.pdf](attachments/003-spec%20v2.pdf)');
    expect(md).toContain('_file not available (too large or could not be downloaded)_');
    expect(md).toContain('### Added later (Mar 23, 2026)');
    expect(md).toContain(
      '## Attachments\n\n- [001-photo.jpg](attachments/001-photo.jpg) — photo, 88 KB, Sam',
    );
  });

  it('uses Persian labels, calendar and digits', async () => {
    const i18n = await createI18n({ language: 'fa', timeZone: 'Asia/Tehran' });
    const md = renderMarkdown({ task, chat, messages, i18n });
    expect(md).toContain('- **وضعیت:** انجام‌شده');
    expect(md).toContain('## گفتگو');
    expect(md).toContain('۱۴۰۵');
    expect(md).toContain('🎤 وویس (1:07)');
    expect(md).toContain('## ضمیمه‌ها');
  });

  it('formats sizes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4321)).toBe('4 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(null)).toBe('');
    expect(formatDuration(67)).toBe('1:07');
    expect(formatDuration(0)).toBe('');
  });
});

describe('buildTaskJson', () => {
  it('exposes the task and its messages with attachment paths', async () => {
    const i18n = await createI18n({ language: 'en', timeZone: 'UTC' });
    const json = buildTaskJson({ task, chat, messages, i18n }) as {
      number: number;
      status: string;
      messages: { attachment: { path: string } | null; kind: string }[];
    };
    expect(json.number).toBe(2);
    expect(json.status).toBe('done');
    expect(json.messages).toHaveLength(6);
    expect(json.messages[1]?.attachment?.path).toBe('attachments/001-photo.jpg');
    expect(json.messages[0]?.attachment).toBeNull();
  });
});

describe('buildZip', () => {
  let dir: string;
  let files: FileStore;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tlg-export-test-'));
    await writeFile(path.join(dir, '001-photo.jpg'), 'jpeg-bytes');
    await writeFile(path.join(dir, '002-voice.oga'), 'ogg-bytes');
    files = {
      absolutePath: (relative) => path.join(dir, path.basename(relative)),
      saveTelegramFile: async () => {
        throw new Error('not used');
      },
      removeTask: async () => undefined,
      removeFiles: async () => undefined,
    };
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('packs markdown, json and the attachments that exist', async () => {
    const i18n = await createI18n({ language: 'en', timeZone: 'UTC' });
    const zip = await buildZip({ task, chat, messages, i18n }, files);
    try {
      expect(zip.fileName).toBe('task-2.zip');
      const bytes = await readFile(zip.path);
      expect(bytes.subarray(0, 2).toString()).toBe('PK');
      for (const name of [
        'task-2.md',
        'task.json',
        'attachments/001-photo.jpg',
        'attachments/002-voice.oga',
      ]) {
        expect(bytes.includes(Buffer.from(name)), name).toBe(true);
      }
      expect(bytes.includes(Buffer.from('attachments/003-spec v2.pdf'))).toBe(false);
      expect(zip.skipped).toEqual(['003-spec v2.pdf']);
    } finally {
      await zip.cleanup();
    }
    await expect(readFile(zip.path)).rejects.toThrow();
  });

  it('can leave attachments out', async () => {
    const i18n = await createI18n({ language: 'en', timeZone: 'UTC' });
    const zip = await buildZip({ task, chat, messages, i18n }, files, {
      includeAttachments: false,
    });
    try {
      const bytes = await readFile(zip.path);
      expect(bytes.includes(Buffer.from('attachments/001-photo.jpg'))).toBe(false);
      expect(zip.skipped).toEqual(['001-photo.jpg', '002-voice.oga', '003-spec v2.pdf']);
    } finally {
      await zip.cleanup();
    }
  });
});
