import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { GrammyError, type Api } from 'grammy';
import { FileTooBigError } from './errors.js';

export interface SaveFileInput {
  fileId: string;
  taskId: number;
  /** 1-based position of this attachment within the task, used as a file name prefix. */
  index: number;
  /** Base name without extension, e.g. "photo" or the original file name without extension. */
  baseName: string;
  /** Preferred extension including the dot, e.g. ".jpg". Falls back to Telegram's file path. */
  extension?: string;
}

export interface SavedFile {
  /** Path relative to the storage directory, e.g. "tasks/12/001-photo.jpg". */
  relativePath: string;
  fileName: string;
  size: number;
}

/** Stores attachments on disk under STORAGE_DIR/tasks/<taskId>/. */
export interface FileStore {
  saveTelegramFile(input: SaveFileInput): Promise<SavedFile>;
  absolutePath(relativePath: string): string;
  removeTask(taskId: number): Promise<void>;
  removeFiles(relativePaths: string[]): Promise<void>;
}

const MAX_BASE_NAME_LENGTH = 60;

/** Makes a user-provided file name safe to store: strips path separators and control characters. */
export function sanitizeBaseName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const shortened = cleaned.slice(0, MAX_BASE_NAME_LENGTH).trim();
  return shortened === '' ? 'file' : shortened;
}

export function splitExtension(fileName: string): { base: string; extension: string } {
  const extension = path.extname(fileName);
  return { base: fileName.slice(0, fileName.length - extension.length), extension };
}

export function attachmentFileName(index: number, baseName: string, extension: string): string {
  return `${String(index).padStart(3, '0')}-${sanitizeBaseName(baseName)}${extension.toLowerCase()}`;
}

export interface FileStoreOptions {
  storageDir: string;
  api: Api;
  token: string;
  /** Overridable for tests. */
  fetchImpl?: typeof fetch;
  apiRoot?: string;
}

export function createFileStore(options: FileStoreOptions): FileStore {
  const storageDir = path.resolve(options.storageDir);
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiRoot = options.apiRoot ?? 'https://api.telegram.org';

  const absolutePath = (relativePath: string) => path.join(storageDir, relativePath);
  const taskDir = (taskId: number) => path.join('tasks', String(taskId));

  return {
    absolutePath,

    async saveTelegramFile(input) {
      let file;
      try {
        file = await options.api.getFile(input.fileId);
      } catch (error) {
        if (error instanceof GrammyError && /too big/i.test(error.description)) {
          throw new FileTooBigError();
        }
        throw error;
      }
      if (!file.file_path) throw new Error('Telegram did not return a file path');

      const extension = input.extension ?? path.extname(file.file_path);
      const fileName = attachmentFileName(input.index, input.baseName, extension);
      const relativePath = path.join(taskDir(input.taskId), fileName);
      const target = absolutePath(relativePath);
      await mkdir(path.dirname(target), { recursive: true });

      const response = await fetchImpl(`${apiRoot}/file/bot${options.token}/${file.file_path}`);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download file: HTTP ${response.status}`);
      }
      await pipeline(
        Readable.fromWeb(response.body as unknown as ReadableStream),
        createWriteStream(target),
      );
      const { size } = await stat(target);
      return { relativePath, fileName, size };
    },

    async removeTask(taskId) {
      await rm(absolutePath(taskDir(taskId)), { recursive: true, force: true });
    },

    async removeFiles(relativePaths) {
      await Promise.all(
        relativePaths.map((relativePath) => rm(absolutePath(relativePath), { force: true })),
      );
    },
  };
}
