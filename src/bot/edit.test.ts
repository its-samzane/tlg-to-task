import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages, tasks } from '../db/schema.js';
import { createTestBot, type TestBot } from '../test/bot.js';
import { CLIENT, OWNER, callbackQuery, photoMessage, textMessage } from '../test/updates.js';

let test: TestBot;

beforeEach(async () => {
  test = await createTestBot();
  await test.bot.handleUpdate(textMessage('/register', { from: OWNER }));
  await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
  await test.bot.handleUpdate(textMessage('Original request', { from: CLIENT }));
  await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));
});

afterEach(async () => {
  await test.close();
});

describe('/edit', () => {
  it('appends new messages to the task and keeps the title', async () => {
    await test.bot.handleUpdate(textMessage('/edit 1', { from: OWNER }));
    expect(test.last()).toBe(
      test.deps.i18n.t('task.editStarted', { number: 1, title: 'Original request' }),
    );
    let [task] = await test.deps.db.select().from(tasks);
    expect(task?.captureState).toBe('edit');
    expect(task?.editRound).toBe(1);

    await test.bot.handleUpdate(textMessage('One more thing', { from: CLIENT }));
    await test.bot.handleUpdate(photoMessage({ from: CLIENT }));
    await test.bot.handleUpdate(callbackQuery(`task:finish:${task!.id}`, { from: CLIENT }));

    [task] = await test.deps.db.select().from(tasks);
    expect(task?.captureState).toBe('none');
    expect(task?.title).toBe('Original request');
    const stored = await test.deps.db.select().from(messages).where(eq(messages.taskId, task!.id));
    expect(stored.map((m) => m.editRound)).toEqual([0, 1, 1]);
    expect(test.last()).toBe(
      test.deps.i18n.t('task.updated', { number: 1, title: 'Original request', count: 2 }),
    );

    // Listing shows the task as a normal task again.
    await test.bot.handleUpdate(textMessage('/list', { from: CLIENT }));
    expect(test.last()).toContain('⬜ <b>#1</b> Original request');
  });

  it('cancelling an edit discards only the additions', async () => {
    await test.bot.handleUpdate(textMessage('/edit 1', { from: CLIENT }));
    await test.bot.handleUpdate(photoMessage({ from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/cancel', { from: CLIENT }));

    const [task] = await test.deps.db.select().from(tasks);
    expect(task?.captureState).toBe('none');
    const stored = await test.deps.db.select().from(messages);
    expect(stored.map((m) => m.text)).toEqual(['Original request']);
    expect(test.files.removedFiles).toEqual([`tasks/${task!.id}/001-photo.jpg`]);
    expect(test.files.removedTasks).toEqual([]);
    expect(test.last()).toBe(test.deps.i18n.t('task.editCancelled', { number: 1 }));
  });

  it('finishing an edit without additions leaves the task unchanged', async () => {
    await test.bot.handleUpdate(textMessage('/edit 1', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));
    const [task] = await test.deps.db.select().from(tasks);
    expect(task?.captureState).toBe('none');
    expect(test.last()).toBe(test.deps.i18n.t('task.editNothingAdded', { number: 1 }));
  });

  it('shares the one-recording-per-group rule', async () => {
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/edit 1', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('task.alreadyRecording', { number: 2 }));

    await test.bot.handleUpdate(textMessage('/cancel', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/edit 1', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/edit 1', { from: OWNER }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.taskRecording', { number: 1 }));
    await test.bot.handleUpdate(textMessage('/new', { from: OWNER }));
    expect(test.last()).toBe(test.deps.i18n.t('task.alreadyRecording', { number: 1 }));
  });

  it('works on done tasks without changing their status', async () => {
    await test.bot.handleUpdate(textMessage('/done 1', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/edit 1', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('Follow-up note', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));
    const [task] = await test.deps.db.select().from(tasks);
    expect(task?.status).toBe('done');
    expect(task?.editRound).toBe(1);
  });
});
