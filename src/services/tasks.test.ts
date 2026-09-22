import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { messages } from '../db/schema.js';
import { deactivateChat, getActiveChat, registerChat } from './chats.js';
import { TaskAlreadyRecordingError } from './errors.js';
import { addMessage, firstTextLine, listMessages } from './messages.js';
import { cancelTask, finishTask, getTaskByNumber, startTask } from './tasks.js';
import { createTestDb } from '../test/db.js';

const CHAT = -42;
let handle: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

beforeAll(async () => {
  handle = await createTestDb();
  db = handle.db;
  await registerChat(db, { chatId: CHAT, title: 'Group', userId: 1 });
});

afterAll(async () => {
  await handle.close();
});

describe('chats', () => {
  it('deactivating keeps the chat but hides it from getActiveChat', async () => {
    await registerChat(db, { chatId: -7, title: 'Other', userId: 1 });
    expect(await getActiveChat(db, -7)).toBeDefined();
    expect(await deactivateChat(db, -7)).toBe(true);
    expect(await deactivateChat(db, -7)).toBe(false);
    expect(await getActiveChat(db, -7)).toBeUndefined();
    const again = await registerChat(db, { chatId: -7, title: 'Other', userId: 1 });
    expect(again.reactivated).toBe(true);
  });
});

describe('tasks', () => {
  it('numbers tasks per chat and allows one recording at a time', async () => {
    const first = await startTask(db, { chatId: CHAT, userId: 1, userName: 'A' });
    expect(first.number).toBe(1);
    await expect(startTask(db, { chatId: CHAT, userId: 2, userName: 'B' })).rejects.toBeInstanceOf(
      TaskAlreadyRecordingError,
    );
    await finishTask(db, first.id, 'First');
    const second = await startTask(db, { chatId: CHAT, userId: 2, userName: 'B' });
    expect(second.number).toBe(2);
    await finishTask(db, second.id, 'Second');
    expect((await getTaskByNumber(db, CHAT, 2))?.title).toBe('Second');
  });

  it('cancelling an edit round only removes messages of that round', async () => {
    const task = await startTask(db, { chatId: CHAT, userId: 1, userName: 'A' });
    const base = {
      taskId: task.id,
      fromUserId: 1,
      fromName: 'A',
      kind: 'text' as const,
      sentAt: new Date(),
    };
    await addMessage(db, { ...base, telegramMessageId: 1, text: 'original', editRound: 0 });
    const closed = await finishTask(db, task.id, 'Title');
    expect(closed.closedAt).toBeInstanceOf(Date);

    // Simulate an edit round (the /edit command sets these fields).
    const editing = { ...closed, captureState: 'edit' as const, editRound: 1 };
    await addMessage(db, {
      ...base,
      telegramMessageId: 2,
      text: 'added later',
      editRound: 1,
      filePath: 'tasks/x/002-photo.jpg',
    });
    const result = await cancelTask(db, editing);
    expect(result.deleted).toBe(false);
    expect(result.removedMessages.map((m) => m.filePath)).toEqual(['tasks/x/002-photo.jpg']);
    const remaining = await listMessages(db, task.id);
    expect(remaining.map((m) => m.text)).toEqual(['original']);
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it('builds a fallback title from the first text line', () => {
    const long = 'x'.repeat(100);
    const list = [
      { text: null, transcript: null },
      { text: '  \n  Fix the checkout button\nmore', transcript: null },
      { text: long, transcript: null },
    ] as Parameters<typeof firstTextLine>[0];
    expect(firstTextLine(list)).toBe('Fix the checkout button');
    expect(firstTextLine(list.slice(2))).toBe(`${'x'.repeat(79)}…`);
    expect(firstTextLine([])).toBeUndefined();
  });
});
