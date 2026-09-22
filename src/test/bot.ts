import type { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { pino } from 'pino';
import { createBot } from '../bot/bot.js';
import type { AppContext, Deps } from '../bot/context.js';
import { loadConfig } from '../config.js';
import { createI18n } from '../i18n.js';
import { FileTooBigError } from '../services/errors.js';
import { attachmentFileName, type FileStore, type SavedFile } from '../services/files.js';
import { PendingWork } from '../services/pending.js';
import { createTestDb } from './db.js';

export const BOT_INFO: UserFromGetMe = {
  id: 999,
  is_bot: true,
  first_name: 'Test Bot',
  username: 'test_task_bot',
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

export const OWNER_ID = 100;

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

/** In-memory FileStore: records what would have been downloaded without touching the network. */
export class FakeFileStore implements FileStore {
  saved: SavedFile[] = [];
  removedTasks: number[] = [];
  removedFiles: string[] = [];
  /** File ids that should behave like files above Telegram's download limit. */
  tooBig = new Set<string>();

  async saveTelegramFile(input: {
    fileId: string;
    taskId: number;
    index: number;
    baseName: string;
    extension?: string;
  }): Promise<SavedFile> {
    if (this.tooBig.has(input.fileId)) throw new FileTooBigError();
    const extension = input.extension ?? (input.baseName === 'voice' ? '.oga' : '.bin');
    const fileName = attachmentFileName(input.index, input.baseName, extension);
    const saved = { relativePath: `tasks/${input.taskId}/${fileName}`, fileName, size: 1234 };
    this.saved.push(saved);
    return saved;
  }

  absolutePath(relativePath: string): string {
    return `/fake-storage/${relativePath}`;
  }

  async removeTask(taskId: number): Promise<void> {
    this.removedTasks.push(taskId);
  }

  async removeFiles(relativePaths: string[]): Promise<void> {
    this.removedFiles.push(...relativePaths);
  }
}

export interface TestBot {
  bot: Bot<AppContext>;
  deps: Deps;
  files: FakeFileStore;
  calls: ApiCall[];
  /** Texts of all messages the bot sent, in order. */
  sent(): string[];
  /** Last message the bot sent. */
  last(): string;
  close(): Promise<void>;
}

export async function createTestBot(
  overrides: Partial<Deps> = {},
  env: Record<string, string> = {},
): Promise<TestBot> {
  const handle = await createTestDb();
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: '1:test',
    OWNER_TELEGRAM_ID: String(OWNER_ID),
    DATABASE_URL: 'postgres://unused',
    ...env,
  });
  const files = new FakeFileStore();
  const deps: Deps = {
    config,
    db: handle.db,
    i18n: await createI18n({ language: config.BOT_LANGUAGE, timeZone: config.TZ }),
    logger: pino({ level: 'silent' }),
    files,
    pending: new PendingWork(),
    ...overrides,
  };

  const bot = createBot(deps, { botInfo: BOT_INFO });
  const calls: ApiCall[] = [];
  let nextMessageId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const p = payload as Record<string, unknown>;
    let result: unknown = true;
    if (method === 'sendMessage') {
      nextMessageId += 1;
      result = {
        message_id: nextMessageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: p.chat_id, type: 'supergroup', title: 'Project X' },
        text: p.text,
      };
    }
    return { ok: true, result } as never;
  });

  const sent = () =>
    calls.filter((call) => call.method === 'sendMessage').map((call) => String(call.payload.text));

  return {
    bot,
    deps,
    files,
    calls,
    sent,
    last: () => sent().at(-1) ?? '',
    close: () => handle.close(),
  };
}
