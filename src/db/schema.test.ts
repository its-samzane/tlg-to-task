import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import { chats, tasks } from './schema.js';
import { createTestDb } from '../test/db.js';

let handle: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

beforeAll(async () => {
  handle = await createTestDb();
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

describe('schema', () => {
  it('applies migrations and stores Telegram-sized ids', async () => {
    const chatId = -1001234567890123;
    await db.insert(chats).values({ chatId, title: 'Project X', registeredByUserId: 42 });
    const [chat] = await db.select().from(chats);
    expect(chat?.chatId).toBe(chatId);
    expect(chat?.nextTaskNumber).toBe(1);
  });

  it('allows only one capturing task per chat', async () => {
    const chatId = -1001234567890123;
    await db.insert(tasks).values({
      chatId,
      number: 1,
      captureState: 'new',
      createdByUserId: 42,
      createdByName: 'Ali',
    });
    await expect(
      db
        .insert(tasks)
        .values({
          chatId,
          number: 2,
          captureState: 'new',
          createdByUserId: 43,
          createdByName: 'Sara',
        })
        .catch((error: unknown) => {
          // Drizzle wraps driver errors; the constraint name lives in the cause.
          throw error instanceof Error && error.cause instanceof Error ? error.cause : error;
        }),
    ).rejects.toThrow(/tasks_one_capturing_per_chat_idx/);

    // Once idle, another task can start collecting.
    await db.update(tasks).set({ captureState: 'none' });
    await expect(
      db.insert(tasks).values({
        chatId,
        number: 2,
        captureState: 'new',
        createdByUserId: 43,
        createdByName: 'Sara',
      }),
    ).resolves.toBeDefined();
  });
});
