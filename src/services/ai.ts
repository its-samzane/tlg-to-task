import type { Message } from '../db/schema.js';

/** Converts a voice or audio file into text. */
export interface Transcriber {
  transcribe(input: { absolutePath: string; fileName: string; mimeType?: string }): Promise<string>;
}

/** Generates a short title for a task from its messages. */
export interface TitleGenerator {
  generateTitle(input: {
    messages: Message[];
    /** Language code the title must be written in, e.g. "fa". */
    language: string;
    /** English name of that language, e.g. "Persian". */
    languageName: string;
  }): Promise<string | undefined>;
}
