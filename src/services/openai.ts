import { createReadStream } from 'node:fs';
import path from 'node:path';
import OpenAI, { toFile } from 'openai';
import type { Message } from '../db/schema.js';
import type { TitleGenerator, Transcriber } from './ai.js';
import { messageText } from './messages.js';

export interface OpenAiClientOptions {
  apiKey: string;
  baseURL?: string;
}

export function createOpenAiClient(options: OpenAiClientOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    // Transient network errors, rate limits and 5xx responses are retried with backoff.
    maxRetries: 2,
    // Long voice messages can take a while to transcribe.
    timeout: 120_000,
  });
}

/** Subset of the OpenAI client the transcriber needs (kept small so tests can fake it). */
export type TranscriptionClient = {
  audio: { transcriptions: { create: OpenAI['audio']['transcriptions']['create'] } };
};

export interface TranscriberOptions {
  model: string;
  /** ISO 639-1 language hint. Undefined lets the model detect the language. */
  language?: string;
}

/** Extensions the transcription endpoint accepts (it judges the format by the file name). */
const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.flac',
  '.m4a',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.mpga',
  '.ogg',
  '.wav',
  '.webm',
]);

const MIME_TO_EXTENSION: Record<string, string> = {
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

/**
 * Chooses the file name sent to OpenAI. Telegram voice notes arrive as ".oga", which the API
 * rejects even though the content is plain Ogg Opus, so unsupported extensions are replaced
 * based on the MIME type (falling back to ".ogg" for Ogg audio).
 */
export function uploadFileName(fileName: string, mimeType?: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (SUPPORTED_AUDIO_EXTENSIONS.has(extension)) return fileName;
  const base = fileName.slice(0, fileName.length - extension.length) || 'audio';
  const mapped = mimeType
    ? MIME_TO_EXTENSION[mimeType.toLowerCase().split(';')[0]!.trim()]
    : undefined;
  if (mapped) return `${base}${mapped}`;
  if (extension === '.oga' || extension === '.opus') return `${base}.ogg`;
  return fileName;
}

export function createOpenAiTranscriber(
  client: TranscriptionClient,
  options: TranscriberOptions,
): Transcriber {
  return {
    async transcribe({ absolutePath, fileName, mimeType }) {
      const result = await client.audio.transcriptions.create({
        file: await toFile(createReadStream(absolutePath), uploadFileName(fileName, mimeType)),
        model: options.model,
        response_format: 'json',
        ...(options.language ? { language: options.language } : {}),
      });
      return result.text.trim();
    },
  };
}

/** Subset of the OpenAI client the title generator needs. */
export type ChatClient = {
  chat: { completions: { create: OpenAI['chat']['completions']['create'] } };
};

export interface TitleGeneratorOptions {
  model: string;
}

const MAX_TITLE_LENGTH = 120;
const MAX_CONVERSATION_CHARS = 12_000;

function labelFor(message: Message): string {
  switch (message.kind) {
    case 'voice':
    case 'audio':
      return message.transcript ? '[voice] ' : '[voice, not transcribed] ';
    case 'photo':
      return '[photo] ';
    case 'video':
    case 'video_note':
      return '[video] ';
    case 'document':
      return `[file${message.fileName ? `: ${message.fileName}` : ''}] `;
    default:
      return '';
  }
}

/** Renders the conversation as "Name: text" lines, trimming the middle if it is very long. */
export function renderConversation(messages: Message[]): string {
  const lines = messages
    .map((message) => {
      const text = messageText(message) ?? '';
      const label = labelFor(message);
      if (!text && !label) return undefined;
      return `${message.fromName}: ${label}${text}`.trim();
    })
    .filter((line): line is string => line !== undefined);
  const full = lines.join('\n');
  if (full.length <= MAX_CONVERSATION_CHARS) return full;
  const half = Math.floor(MAX_CONVERSATION_CHARS / 2);
  return `${full.slice(0, half)}\n[...]\n${full.slice(-half)}`;
}

export function systemPrompt(languageName: string): string {
  return [
    'You write titles for tasks collected from a team chat.',
    'Read the conversation and reply with one short title (at most 10 words) that says what needs to be done.',
    `Write the title in ${languageName}.`,
    'Output only the title: no quotes, no numbering, no trailing punctuation, no explanation.',
  ].join(' ');
}

/** Normalizes model output into a single clean line. */
export function cleanTitle(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (!firstLine) return undefined;
  let title = firstLine.replace(/^(title|عنوان)\s*[:：]\s*/i, '').trim();
  // Models sometimes wrap the title in quotes and end it with a period; peel both off.
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = title
      .replace(/^["'«»“”‘’`*_#-]+|["'«»“”‘’`*_]+$/g, '')
      .replace(/[.。:：;؛]+$/u, '')
      .trim();
    if (stripped === title) break;
    title = stripped;
  }
  if (title.length > MAX_TITLE_LENGTH) title = `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
  return title === '' ? undefined : title;
}

export function createOpenAiTitleGenerator(
  client: ChatClient,
  options: TitleGeneratorOptions,
): TitleGenerator {
  return {
    async generateTitle({ messages, languageName }) {
      const conversation = renderConversation(messages);
      if (conversation.trim() === '') return undefined;
      const completion = await client.chat.completions.create({
        model: options.model,
        messages: [
          { role: 'system', content: systemPrompt(languageName) },
          { role: 'user', content: conversation },
        ],
        max_completion_tokens: 200,
      });
      return cleanTitle(completion.choices[0]?.message.content);
    },
  };
}
