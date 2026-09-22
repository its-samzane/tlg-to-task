import type { Context } from 'grammy';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { Chat } from '../db/schema.js';
import type { I18n, Translate } from '../i18n.js';
import type { Logger } from '../logger.js';
import type { TitleGenerator, Transcriber } from '../services/ai.js';
import type { FileStore } from '../services/files.js';
import type { PendingWork } from '../services/pending.js';

export interface Deps {
  config: Config;
  db: Db;
  i18n: I18n;
  logger: Logger;
  files: FileStore;
  pending: PendingWork;
  /** Optional: without it voice messages are stored without a transcript. */
  transcriber?: Transcriber;
  /** Optional: without it titles fall back to the first line of text. */
  titles?: TitleGenerator;
}

export type AppContext = Context & {
  deps: Deps;
  t: Translate;
  /** The registered, active group this update belongs to (undefined in private or unknown chats). */
  chatRecord?: Chat;
};
