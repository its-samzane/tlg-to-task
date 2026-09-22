import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { messages, tasks } from '../db/schema.js';
import type { TitleGenerator, Transcriber } from '../services/ai.js';
import { createTestBot, type TestBot } from '../test/bot.js';
import { CLIENT, OWNER, textMessage, voiceMessage } from '../test/updates.js';

let test: TestBot;

afterEach(async () => {
  await test.close();
});

function transcriber(behaviour: 'ok' | 'fail'): Transcriber {
  return {
    async transcribe({ fileName }) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (behaviour === 'fail') throw new Error('service unavailable');
      return `transcript of ${fileName}`;
    },
  };
}

function titles(behaviour: 'ok' | 'fail' | 'empty'): TitleGenerator {
  return {
    async generateTitle({ messages: list, languageName }) {
      if (behaviour === 'fail') throw new Error('rate limited');
      if (behaviour === 'empty') return undefined;
      return `${languageName} title for ${list.length} messages`;
    },
  };
}

describe('recording with OpenAI services', () => {
  beforeEach(async () => {
    test = await createTestBot({ transcriber: transcriber('ok'), titles: titles('ok') });
    await test.bot.handleUpdate(textMessage('/register', { from: OWNER }));
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
  });

  it('transcribes voice messages before finishing and uses the generated title', async () => {
    await test.bot.handleUpdate(voiceMessage({ from: CLIENT }));
    const [pending] = await test.deps.db.select().from(messages);
    expect(pending?.transcriptionStatus).toBe('pending');

    await test.bot.handleUpdate(textMessage('/end', { from: CLIENT }));
    const [stored] = await test.deps.db.select().from(messages);
    expect(stored?.transcriptionStatus).toBe('done');
    expect(stored?.transcript).toBe('transcript of 001-voice.oga');
    const [task] = await test.deps.db.select().from(tasks);
    expect(task?.title).toBe('English title for 1 messages');
    expect(test.last()).toContain('English title for 1 messages');
  });
});

describe('recording when OpenAI fails', () => {
  it('marks failed transcriptions, warns the group and falls back to the first text line', async () => {
    test = await createTestBot({ transcriber: transcriber('fail'), titles: titles('fail') });
    await test.bot.handleUpdate(textMessage('/register', { from: OWNER }));
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(voiceMessage({ from: CLIENT }));
    await test.bot.handleUpdate(
      textMessage('Please update the invoice template', { from: CLIENT }),
    );
    await test.bot.handleUpdate(textMessage('/end', { from: OWNER }));

    const stored = await test.deps.db.select().from(messages);
    expect(stored.find((m) => m.kind === 'voice')?.transcriptionStatus).toBe('failed');
    expect(test.sent()).toContain(test.deps.i18n.t('capture.transcriptionFailed'));
    const [task] = await test.deps.db.select().from(tasks);
    expect(task?.title).toBe('Please update the invoice template');
    expect(task?.captureState).toBe('none');
  });

  it('uses the localized placeholder title when there is no text at all', async () => {
    test = await createTestBot({ transcriber: transcriber('fail'), titles: titles('empty') });
    await test.bot.handleUpdate(textMessage('/register', { from: OWNER }));
    await test.bot.handleUpdate(textMessage('/new', { from: CLIENT }));
    await test.bot.handleUpdate(voiceMessage({ from: CLIENT }));
    await test.bot.handleUpdate(textMessage('/end', { from: OWNER }));
    const [task] = await test.deps.db.select().from(tasks);
    expect(task?.title).toBe('Task #1');
  });
});
