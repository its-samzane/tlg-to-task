import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tasks } from '../db/schema.js';
import { createTestBot, type TestBot } from '../test/bot.js';
import { CLIENT, OWNER, callbackQuery, textMessage } from '../test/updates.js';
import { chunkLines } from './commands/manage.js';

let test: TestBot;

async function recordTask(text: string): Promise<void> {
  await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
  await test.bot.handleUpdate(textMessage(text, { from: CLIENT }));
  await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));
}

beforeEach(async () => {
  test = await createTestBot();
  await test.bot.handleUpdate(textMessage('/register', { from: OWNER }));
});

afterEach(async () => {
  await test.close();
});

describe('/list', () => {
  it('explains when there are no tasks', async () => {
    await test.bot.handleUpdate(textMessage('/list', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('list.empty'));
  });

  it('lists tasks newest first with their status', async () => {
    await recordTask('First task <b>');
    await recordTask('Second task');
    await test.bot.handleUpdate(textMessage('/done 1', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/list', { from: CLIENT }));

    const lines = test.last().split('\n');
    expect(lines[0]).toBe(test.deps.i18n.t('list.header', { total: 3, open: 2, done: 1 }));
    expect(lines.slice(2)).toEqual([
      `🎙 <b>#3</b> ${test.deps.i18n.t('list.recording')}`,
      '⬜ <b>#2</b> Second task',
      '✅ <b>#1</b> First task &lt;b&gt;',
    ]);
  });

  it('splits long lists into several messages', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `⬜ <b>#${i}</b> ${'x'.repeat(40)}`);
    const chunks = chunkLines(lines, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(chunks.join('\n').split('\n')).toHaveLength(300);
  });
});

describe('/done and /undone', () => {
  beforeEach(async () => {
    await recordTask('Fix the footer');
  });

  it('toggles the status and reports the title', async () => {
    await test.bot.handleUpdate(textMessage('/done 1', { from: CLIENT }));
    expect(test.last()).toBe(
      test.deps.i18n.t('status.done', { number: 1, title: 'Fix the footer' }),
    );
    let [task] = await test.deps.db.select().from(tasks);
    expect(task?.status).toBe('done');
    expect(task?.doneAt).toBeInstanceOf(Date);

    await test.bot.handleUpdate(textMessage('/done #1', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('status.alreadyDone', { number: 1 }));

    await test.bot.handleUpdate(textMessage('/undone 1', { from: OWNER }));
    [task] = await test.deps.db.select().from(tasks);
    expect(task?.status).toBe('open');
    expect(task?.doneAt).toBeNull();
  });

  it('validates the argument', async () => {
    await test.bot.handleUpdate(textMessage('/done', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.usageNumber', { command: 'done' }));
    await test.bot.handleUpdate(textMessage('/done abc', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.usageNumber', { command: 'done' }));
    await test.bot.handleUpdate(textMessage('/done 42', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.taskNotFound', { number: 42 }));
  });

  it('refuses to change a task that is still recording', async () => {
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/done 2', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.taskRecording', { number: 2 }));
  });
});

describe('/delete', () => {
  beforeEach(async () => {
    await recordTask('Remove me');
  });

  it('is owner-only by default', async () => {
    await test.bot.handleUpdate(textMessage('/delete 1', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.ownerOnly'));
    expect(await test.deps.db.select().from(tasks)).toHaveLength(1);
  });

  it('asks for confirmation and deletes the task with its files', async () => {
    await test.bot.handleUpdate(textMessage('/delete 1', { from: OWNER }));
    const confirm = test.calls.filter((call) => call.method === 'sendMessage').at(-1)!;
    expect(String(confirm.payload.text)).toContain('Remove me');
    expect(confirm.payload.reply_markup).toBeDefined();
    const [task] = await test.deps.db.select().from(tasks);

    // Somebody else cannot confirm.
    await test.bot.handleUpdate(
      callbackQuery(`task:delete:confirm:${task!.id}:${OWNER.id}`, { from: CLIENT }),
    );
    expect(await test.deps.db.select().from(tasks)).toHaveLength(1);
    const refused = test.calls.filter((call) => call.method === 'answerCallbackQuery').at(-1)!;
    expect(refused.payload.text).toBe(test.deps.i18n.t.raw('callback.notYours'));

    await test.bot.handleUpdate(
      callbackQuery(`task:delete:confirm:${task!.id}:${OWNER.id}`, { from: OWNER }),
    );
    expect(await test.deps.db.select().from(tasks)).toHaveLength(0);
    expect(test.files.removedTasks).toEqual([task!.id]);
    const edited = test.calls.filter((call) => call.method === 'editMessageText').at(-1)!;
    expect(edited.payload.text).toBe(test.deps.i18n.t('delete.done', { number: 1 }));
  });

  it('"Keep" leaves the task untouched', async () => {
    await test.bot.handleUpdate(textMessage('/delete 1', { from: OWNER }));
    const [task] = await test.deps.db.select().from(tasks);
    await test.bot.handleUpdate(
      callbackQuery(`task:delete:keep:${task!.id}:${OWNER.id}`, { from: OWNER }),
    );
    expect(await test.deps.db.select().from(tasks)).toHaveLength(1);
    const edited = test.calls.filter((call) => call.method === 'editMessageText').at(-1)!;
    expect(edited.payload.text).toBe(test.deps.i18n.t('delete.kept', { number: 1 }));
  });

  it('can be opened to members with ALLOW_MEMBER_DELETE', async () => {
    await test.close();
    test = await createTestBot({}, { ALLOW_MEMBER_DELETE: 'true' });
    await test.bot.handleUpdate(textMessage('/register', { from: OWNER }));
    await recordTask('Member deletable');
    await test.bot.handleUpdate(textMessage('/delete 1', { from: CLIENT }));
    expect(test.last()).toContain('Member deletable');
  });
});
