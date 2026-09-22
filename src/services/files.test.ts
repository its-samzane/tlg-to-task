import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GrammyError, type Api } from 'grammy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileTooBigError } from './errors.js';
import { attachmentFileName, createFileStore, sanitizeBaseName, splitExtension } from './files.js';

describe('file names', () => {
  it('sanitizes user-provided names', () => {
    expect(sanitizeBaseName('../etc/passwd')).toBe('_etc_passwd');
    expect(sanitizeBaseName('  report: final?  ')).toBe('report_ final_');
    expect(sanitizeBaseName('گزارش نهایی')).toBe('گزارش نهایی');
    expect(sanitizeBaseName('')).toBe('file');
    expect(sanitizeBaseName('a'.repeat(100))).toHaveLength(60);
  });

  it('splits extensions and builds numbered names', () => {
    expect(splitExtension('spec v2.PDF')).toEqual({ base: 'spec v2', extension: '.PDF' });
    expect(splitExtension('noext')).toEqual({ base: 'noext', extension: '' });
    expect(attachmentFileName(3, 'spec v2', '.PDF')).toBe('003-spec v2.pdf');
  });
});

describe('createFileStore', () => {
  let dir: string;
  const api = {
    async getFile(fileId: string) {
      if (fileId === 'huge') {
        throw new GrammyError(
          'Bad Request',
          { ok: false, error_code: 400, description: 'Bad Request: file is too big' },
          'getFile',
          {},
        );
      }
      return { file_id: fileId, file_unique_id: 'u', file_path: `voice/${fileId}.oga` };
    },
  } as unknown as Api;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tlg-store-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('downloads files into the task folder and removes them again', async () => {
    const requested: string[] = [];
    const store = createFileStore({
      storageDir: dir,
      api,
      token: 'TOKEN',
      apiRoot: 'https://example.test',
      fetchImpl: (async (url: string | URL | Request) => {
        requested.push(String(url));
        return new Response('audio-bytes');
      }) as typeof fetch,
    });

    const saved = await store.saveTelegramFile({
      fileId: 'abc',
      taskId: 5,
      index: 1,
      baseName: 'voice',
    });
    expect(saved.relativePath).toBe(path.join('tasks', '5', '001-voice.oga'));
    expect(saved.size).toBe('audio-bytes'.length);
    expect(requested).toEqual(['https://example.test/file/botTOKEN/voice/abc.oga']);
    expect(await readFile(store.absolutePath(saved.relativePath), 'utf8')).toBe('audio-bytes');

    await store.removeTask(5);
    await expect(readFile(store.absolutePath(saved.relativePath))).rejects.toThrow();
  });

  it("maps Telegram's size limit to FileTooBigError", async () => {
    const store = createFileStore({ storageDir: dir, api, token: 'TOKEN' });
    await expect(
      store.saveTelegramFile({ fileId: 'huge', taskId: 6, index: 1, baseName: 'video' }),
    ).rejects.toBeInstanceOf(FileTooBigError);
  });
});
