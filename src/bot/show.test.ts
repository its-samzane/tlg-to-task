import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBot, type TestBot } from '../test/bot.js';
import { CLIENT, OWNER, textMessage } from '../test/updates.js';

let test: TestBot;

beforeEach(async () => {
  test = await createTestBot();
  await test.bot.handleUpdate(textMessage('/register', { from: OWNER }));
});

afterEach(async () => {
  await test.close();
});

describe('/show', () => {
  it('sends the task as a zip document with the title as caption', async () => {
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('Export <me>', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));

    await test.bot.handleUpdate(textMessage('/show 1', { from: OWNER }));
    const document = test.calls.find((call) => call.method === 'sendDocument');
    expect(document).toBeDefined();
    expect(document?.payload.caption).toBe('#1 <b>Export &lt;me&gt;</b>');
    expect(test.calls.some((call) => call.method === 'sendChatAction')).toBe(true);
  });

  it('validates the task number and refuses recording tasks', async () => {
    await test.bot.handleUpdate(textMessage('/show', { from: OWNER }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.usageNumber', { command: 'show' }));
    await test.bot.handleUpdate(textMessage('/show 9', { from: OWNER }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.taskNotFound', { number: 9 }));
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/show 1', { from: OWNER }));
    expect(test.last()).toBe(test.deps.i18n.t('errors.taskRecording', { number: 1 }));
  });
});
