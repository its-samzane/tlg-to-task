import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { messages, type Message, type NewMessage } from '../db/schema.js';

export async function addMessage(db: Db, input: NewMessage): Promise<Message> {
  const [message] = await db.insert(messages).values(input).returning();
  return message!;
}

/** All messages of a task in the order they were sent. */
export async function listMessages(db: Db, taskId: number): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.taskId, taskId))
    .orderBy(asc(messages.sentAt), asc(messages.telegramMessageId));
}

/** 1-based index for the next attachment of a task (used for file names like 003-photo.jpg). */
export async function nextAttachmentIndex(db: Db, taskId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.taskId, taskId), isNotNull(messages.filePath)));
  return (row?.count ?? 0) + 1;
}

export async function setTranscription(
  db: Db,
  messageId: number,
  status: Message['transcriptionStatus'],
  transcript?: string,
): Promise<void> {
  await db
    .update(messages)
    .set({ transcriptionStatus: status, ...(transcript !== undefined ? { transcript } : {}) })
    .where(eq(messages.id, messageId));
}

/** Text content of a message as it should appear in exports: text, caption and/or transcript. */
export function messageText(message: Message): string | undefined {
  const parts = [message.text, message.transcript].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/** First non-empty line of text in the conversation, used as a fallback title. */
export function firstTextLine(list: Message[], maxLength = 80): string | undefined {
  for (const message of list) {
    const text = messageText(message);
    const line = text
      ?.split('\n')
      .map((part) => part.trim())
      .find((part) => part !== '');
    if (line) {
      return line.length > maxLength ? `${line.slice(0, maxLength - 1).trimEnd()}…` : line;
    }
  }
  return undefined;
}
