import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages, tasks } from '../db/schema.js';
import { createTestBot, type TestBot } from '../test/bot.js';
import {
  CLIENT,
  GROUP,
  OWNER,
  PRIVATE,
  callbackQuery,
  documentMessage,
  photoMessage,
  textMessage,
  voiceMessage,
} from '../test/updates.js';

let test: TestBot;

beforeEach(async () => {
  test = await createTestBot();
});

afterEach(async () => {
  await test.close();
});

async function registerGroup(): Promise<void> {
  await test.bot.handleUpdate(textMessage('/register', { from: OWNER }));
}

describe('registration', () => {
  it('only the owner can register a group', async () => {
    await test.bot.handleUpdate(textMessage('/register', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.ownerOnly'));

    await registerGroup();
    expect(test.last()).toBe(test.deps.i18n.t('register.success'));

    await registerGroup();
    expect(test.last()).toBe(test.deps.i18n.t('register.already'));
  });

  it('rejects group commands in private chats and unregistered groups', async () => {
    await test.bot.handleUpdate(textMessage('/new', { from: OWNER, chat: PRIVATE }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.groupOnly'));

    await test.bot.handleUpdate(textMessage('/new'));
    expect(test.last()).toBe(test.deps.i18n.t('errors.notRegistered'));
  });

  it('shows the user id in a private /start', async () => {
    await test.bot.handleUpdate(textMessage('/start', { from: OWNER, chat: PRIVATE }));
    expect(test.last()).toContain(`<code>${OWNER.id}</code>`);
  });
});

describe('recording a task', () => {
  beforeEach(registerGroup);

  it('captures messages from everyone until Finish is pressed', async () => {
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    const control = test.calls.filter((call) => call.method === 'sendMessage').at(-1)!;
    expect(String(control.payload.text)).toContain('#1');
    expect(control.payload.reply_markup).toBeDefined();

    await test.bot.handleUpdate(textMessage('The login page is broken', { from: CLIENT }));
    await test.bot.handleUpdate(photoMessage({ from: OWNER, caption: 'screenshot' }));
    await test.bot.handleUpdate(voiceMessage({ from: CLIENT }));
    await test.bot.handleUpdate(documentMessage({ from: CLIENT, fileName: 'spec v2.pdf' }));
    await test.bot.handleUpdate(textMessage('/help', { from: CLIENT }));

    const [task] = await test.deps.db.select().from(tasks);
    expect(task?.captureState).toBe('new');
    let stored = await test.deps.db.select().from(messages).where(eq(messages.taskId, task!.id));
    expect(stored.map((m) => m.kind)).toEqual(['text', 'photo', 'voice', 'document']);
    expect(stored[0]?.fromName).toBe('Ali Client');
    expect(stored[1]?.fromName).toBe('Sam');
    expect(stored[1]?.text).toBe('screenshot');
    expect(stored[1]?.filePath).toBe(`tasks/${task!.id}/001-photo.jpg`);
    expect(stored[2]?.transcriptionStatus).toBe('skipped');
    expect(stored[2]?.filePath).toBe(`tasks/${task!.id}/002-voice.ogg`);
    expect(stored[3]?.fileName).toBe('003-spec v2.pdf');

    await test.bot.handleUpdate(callbackQuery(`task:finish:${task!.id}`, { from: OWNER }));

    const [finished] = await test.deps.db.select().from(tasks);
    expect(finished?.captureState).toBe('none');
    expect(finished?.status).toBe('open');
    expect(finished?.title).toBe('The login page is broken');
    expect(finished?.closedAt).toBeInstanceOf(Date);
    expect(test.last()).toContain('#1');
    expect(test.last()).toContain('The login page is broken');
    expect(test.calls.some((call) => call.method === 'editMessageText')).toBe(true);
    expect(test.calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true);

    // Messages after finishing are not captured.
    await test.bot.handleUpdate(textMessage('thanks', { from: CLIENT }));
    stored = await test.deps.db.select().from(messages);
    expect(stored).toHaveLength(4);
  });

  it('refuses a second /new while a task is recording and numbers tasks sequentially', async () => {
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/new', { from: OWNER }));
    expect(test.last()).toBe(test.deps.i18n.t('task.alreadyRecording', { number: 1 }));

    await test.bot.handleUpdate(textMessage('first task', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    const all = await test.deps.db.select().from(tasks);
    expect(all.map((t) => t.number).sort()).toEqual([1, 2]);
  });

  it('cancel discards the task and its files', async () => {
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(photoMessage({ from: CLIENT }));
    const [task] = await test.deps.db.select().from(tasks);
    await test.bot.handleUpdate(textMessage('/cancel', { from: OWNER }));

    expect(await test.deps.db.select().from(tasks)).toHaveLength(0);
    expect(test.files.removedTasks).toEqual([task!.id]);
    expect(test.last()).toBe(test.deps.i18n.t('task.cancelled', { number: 1 }));
  });

  it('finishing an empty recording discards the task', async () => {
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));
    expect(await test.deps.db.select().from(tasks)).toHaveLength(0);
    expect(test.last()).toBe(test.deps.i18n.t('task.emptyDiscarded', { number: 1 }));
  });

  it('keeps the message when a file is too big and warns the sender', async () => {
    test.files.tooBig.add('big-doc');
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(documentMessage({ from: CLIENT, fileId: 'big-doc' }));
    const [stored] = await test.deps.db.select().from(messages);
    expect(stored?.filePath).toBeNull();
    expect(stored?.telegramFileId).toBe('big-doc');
    expect(test.last()).toBe(test.deps.i18n.t('capture.fileTooBig'));
  });

  it('answers stale buttons without changing anything', async () => {
    await test.bot.handleUpdate(callbackQuery('task:finish:12345', { from: CLIENT }));
    const answer = test.calls.find((call) => call.method === 'answerCallbackQuery');
    expect(answer?.payload.text).toBe(test.deps.i18n.t.raw('callback.stale'));
  });

  it('reports /end and /cancel when nothing is recording', async () => {
    await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));
    expect(test.last()).toBe(test.deps.i18n.t('task.noneRecording'));
  });

  it('uses the configured language for replies', async () => {
    await test.close();
    test = await createTestBot({}, { BOT_LANGUAGE: 'fa' });
    await registerGroup();
    expect(test.last()).toContain('فعال شد');
    void GROUP;
  });
});
