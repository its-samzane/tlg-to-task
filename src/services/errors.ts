import type { Task } from '../db/schema.js';

/** Thrown when /new is used while another task in the same chat is still recording. */
export class TaskAlreadyRecordingError extends Error {
  constructor(public readonly task: Task) {
    super(`Task #${task.number} is already recording`);
    this.name = 'TaskAlreadyRecordingError';
  }
}

/** Thrown when Telegram refuses to serve a file (Bot API limit is 20 MB). */
export class FileTooBigError extends Error {
  constructor() {
    super('File is too big to download through the Bot API');
    this.name = 'FileTooBigError';
  }
}

/** Returns the PostgreSQL error code of a (possibly wrapped) driver error. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = current.cause;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
