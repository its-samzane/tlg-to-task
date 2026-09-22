import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '../db/schema.js';
import {
  cleanTitle,
  createOpenAiTitleGenerator,
  createOpenAiTranscriber,
  renderConversation,
  uploadFileName,
  type ChatClient,
  type TranscriptionClient,
} from './openai.js';

describe('uploadFileName', () => {
  it('keeps supported extensions and fixes unsupported ones from the MIME type', () => {
    expect(uploadFileName('001-voice.ogg', 'audio/ogg')).toBe('001-voice.ogg');
    expect(uploadFileName('001-voice.oga', 'audio/ogg')).toBe('001-voice.ogg');
    expect(uploadFileName('001-voice.oga')).toBe('001-voice.ogg');
    expect(uploadFileName('002-song.opus', 'audio/opus')).toBe('002-song.ogg');
    expect(uploadFileName('003-memo.aac', 'audio/aac')).toBe('003-memo.m4a');
    expect(uploadFileName('004-clip.MP3', 'audio/mpeg')).toBe('004-clip.MP3');
    expect(uploadFileName('005-unknown.xyz', 'audio/strange')).toBe('005-unknown.xyz');
  });
});

function message(partial: Partial<Message>): Message {
  return {
    id: 1,
    taskId: 1,
    telegramMessageId: 1,
    fromUserId: 1,
    fromName: 'Ali',
    kind: 'text',
    text: null,
    transcript: null,
    transcriptionStatus: 'none',
    telegramFileId: null,
    filePath: null,
    fileName: null,
    mimeType: null,
    fileSize: null,
    durationSeconds: null,
    editRound: 0,
    sentAt: new Date(),
    createdAt: new Date(),
    ...partial,
  };
}

describe('cleanTitle', () => {
  it('strips quotes, labels, trailing punctuation and extra lines', () => {
    expect(cleanTitle('"Fix the login page."')).toBe('Fix the login page');
    expect(cleanTitle('Title: Fix the login page\nSecond line')).toBe('Fix the login page');
    expect(cleanTitle('«رفع مشکل ورود».')).toBe('رفع مشکل ورود');
    expect(cleanTitle('   ')).toBeUndefined();
    expect(cleanTitle(null)).toBeUndefined();
    expect(cleanTitle('x'.repeat(200))).toHaveLength(120);
  });
});

describe('renderConversation', () => {
  it('labels media and skips empty messages', () => {
    const rendered = renderConversation([
      message({ text: 'Hello' }),
      message({ kind: 'voice', transcript: 'spoken words', fromName: 'Sara' }),
      message({ kind: 'voice', transcriptionStatus: 'failed' }),
      message({ kind: 'photo', text: 'screenshot' }),
      message({ kind: 'document', fileName: '001-spec.pdf' }),
      message({ kind: 'sticker' }),
    ]);
    expect(rendered.split('\n')).toEqual([
      'Ali: Hello',
      'Sara: [voice] spoken words',
      'Ali: [voice, not transcribed]',
      'Ali: [photo] screenshot',
      'Ali: [file: 001-spec.pdf]',
    ]);
  });

  it('trims very long conversations in the middle', () => {
    const list = Array.from({ length: 400 }, (_, i) =>
      message({ text: `line ${i} ${'x'.repeat(50)}` }),
    );
    const rendered = renderConversation(list);
    expect(rendered.length).toBeLessThan(12_100);
    expect(rendered).toContain('[...]');
  });
});

describe('createOpenAiTitleGenerator', () => {
  it('sends the conversation with a language instruction and cleans the answer', async () => {
    const calls: unknown[] = [];
    const client = {
      chat: {
        completions: {
          create: async (params: unknown) => {
            calls.push(params);
            return { choices: [{ message: { content: '"Repair checkout button".' } }] };
          },
        },
      },
    } as unknown as ChatClient;
    const generator = createOpenAiTitleGenerator(client, { model: 'test-model' });
    const title = await generator.generateTitle({
      messages: [message({ text: 'The checkout button does nothing' })],
      language: 'fa',
      languageName: 'Persian',
    });
    expect(title).toBe('Repair checkout button');
    const params = calls[0] as { model: string; messages: { role: string; content: string }[] };
    expect(params.model).toBe('test-model');
    expect(params.messages[0]?.content).toContain('in Persian');
    expect(params.messages[1]?.content).toBe('Ali: The checkout button does nothing');
  });

  it('returns undefined when there is nothing to summarize', async () => {
    const client = {
      chat: { completions: { create: async () => ({ choices: [] }) } },
    } as unknown as ChatClient;
    const generator = createOpenAiTitleGenerator(client, { model: 'm' });
    await expect(
      generator.generateTitle({ messages: [], language: 'en', languageName: 'English' }),
    ).resolves.toBeUndefined();
    await expect(
      generator.generateTitle({
        messages: [message({ text: 'hi' })],
        language: 'en',
        languageName: 'English',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('createOpenAiTranscriber', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'tlg-openai-'));
    await writeFile(path.join(dir, '001-voice.oga'), 'fake audio bytes');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('uploads the file with the model and language hint', async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      audio: {
        transcriptions: {
          create: async (params: Record<string, unknown>) => {
            calls.push(params);
            return { text: '  سلام دنیا  ' };
          },
        },
      },
    } as unknown as TranscriptionClient;

    const transcriber = createOpenAiTranscriber(client, { model: 'stt-model', language: 'fa' });
    const text = await transcriber.transcribe({
      absolutePath: path.join(dir, '001-voice.oga'),
      fileName: '001-voice.oga',
    });
    expect(text).toBe('سلام دنیا');
    expect(calls[0]?.model).toBe('stt-model');
    expect(calls[0]?.language).toBe('fa');
    expect(calls[0]?.response_format).toBe('json');
    const file = calls[0]?.file as File;
    // ".oga" is renamed to ".ogg" because OpenAI rejects the "oga" spelling.
    expect(file.name).toBe('001-voice.ogg');
    expect(await file.text()).toBe('fake audio bytes');

    const auto = createOpenAiTranscriber(client, { model: 'stt-model' });
    await auto.transcribe({ absolutePath: path.join(dir, '001-voice.oga'), fileName: 'v.oga' });
    expect('language' in calls[1]!).toBe(false);
  });
});
