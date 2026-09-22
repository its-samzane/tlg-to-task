import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chats, type Chat } from '../db/schema.js';

export interface RegisterChatInput {
  chatId: number;
  title: string | null;
  userId: number;
}

export interface RegisterChatResult {
  chat: Chat;
  /** True when the chat was registered for the first time. */
  created: boolean;
  /** True when a previously deactivated chat was activated again. */
  reactivated: boolean;
}

export async function registerChat(db: Db, input: RegisterChatInput): Promise<RegisterChatResult> {
  const [existing] = await db.select().from(chats).where(eq(chats.chatId, input.chatId));
  if (!existing) {
    const [chat] = await db
      .insert(chats)
      .values({ chatId: input.chatId, title: input.title, registeredByUserId: input.userId })
      .returning();
    return { chat: chat!, created: true, reactivated: false };
  }
  if (!existing.active) {
    const [chat] = await db
      .update(chats)
      .set({ active: true, title: input.title })
      .where(eq(chats.chatId, input.chatId))
      .returning();
    return { chat: chat!, created: false, reactivated: true };
  }
  return { chat: existing, created: false, reactivated: false };
}

/** Deactivates a chat. Its tasks are kept. Returns false when the chat was not active. */
export async function deactivateChat(db: Db, chatId: number): Promise<boolean> {
  const updated = await db
    .update(chats)
    .set({ active: false })
    .where(and(eq(chats.chatId, chatId), eq(chats.active, true)))
    .returning({ chatId: chats.chatId });
  return updated.length > 0;
}

export async function getActiveChat(db: Db, chatId: number): Promise<Chat | undefined> {
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.chatId, chatId), eq(chats.active, true)));
  return chat;
}

export async function updateChatTitle(db: Db, chatId: number, title: string | null): Promise<void> {
  await db.update(chats).set({ title }).where(eq(chats.chatId, chatId));
}
