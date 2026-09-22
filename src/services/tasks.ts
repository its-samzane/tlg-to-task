import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chats, messages, tasks, type Message, type Task } from '../db/schema.js';
import { PG_UNIQUE_VIOLATION, pgErrorCode, TaskAlreadyRecordingError } from './errors.js';

export interface StartTaskInput {
  chatId: number;
  userId: number;
  userName: string;
}

/** Creates a new task in "recording" state with the next number for the chat. */
export async function startTask(db: Db, input: StartTaskInput): Promise<Task> {
  try {
    return await db.transaction(async (tx) => {
      const existing = await getCapturingTask(tx, input.chatId);
      if (existing) throw new TaskAlreadyRecordingError(existing);

      const [chat] = await tx
        .update(chats)
        .set({ nextTaskNumber: sql`${chats.nextTaskNumber} + 1` })
        .where(eq(chats.chatId, input.chatId))
        .returning({ nextTaskNumber: chats.nextTaskNumber });
      if (!chat) throw new Error(`Chat ${input.chatId} is not registered`);

      const [task] = await tx
        .insert(tasks)
        .values({
          chatId: input.chatId,
          number: chat.nextTaskNumber - 1,
          captureState: 'new',
          createdByUserId: input.userId,
          createdByName: input.userName,
        })
        .returning();
      return task!;
    });
  } catch (error) {
    // Two /new commands raced: the partial unique index rejected the second one.
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      const existing = await getCapturingTask(db, input.chatId);
      if (existing) throw new TaskAlreadyRecordingError(existing);
    }
    throw error;
  }
}

export async function getCapturingTask(db: Db, chatId: number): Promise<Task | undefined> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.chatId, chatId), ne(tasks.captureState, 'none')))
    .limit(1);
  return task;
}

export async function getTaskById(db: Db, taskId: number): Promise<Task | undefined> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  return task;
}

export async function getTaskByNumber(
  db: Db,
  chatId: number,
  number: number,
): Promise<Task | undefined> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.chatId, chatId), eq(tasks.number, number)));
  return task;
}

export async function setControlMessage(db: Db, taskId: number, messageId: number): Promise<void> {
  await db.update(tasks).set({ controlMessageId: messageId }).where(eq(tasks.id, taskId));
}

/** Ends the current recording (new task or edit round) and stores the title if one is given. */
export async function finishTask(db: Db, taskId: number, title?: string): Promise<Task> {
  const now = new Date();
  const [task] = await db
    .update(tasks)
    .set({
      captureState: 'none',
      closedAt: sql`coalesce(${tasks.closedAt}, ${now})`,
      updatedAt: now,
      ...(title !== undefined ? { title } : {}),
    })
    .where(eq(tasks.id, taskId))
    .returning();
  return task!;
}

export interface CancelResult {
  /** True when the whole task was removed (it was never finished before). */
  deleted: boolean;
  /** Messages that were discarded; their files should be removed from storage. */
  removedMessages: Message[];
}

/**
 * Cancels the current recording. A task that was never finished is deleted entirely; for an
 * edit round only the messages added in that round are discarded.
 */
export async function cancelTask(db: Db, task: Task): Promise<CancelResult> {
  if (task.captureState === 'new') {
    const removedMessages = await db.select().from(messages).where(eq(messages.taskId, task.id));
    await db.delete(tasks).where(eq(tasks.id, task.id));
    return { deleted: true, removedMessages };
  }
  const removedMessages = await db
    .delete(messages)
    .where(and(eq(messages.taskId, task.id), eq(messages.editRound, task.editRound)))
    .returning();
  await db
    .update(tasks)
    .set({ captureState: 'none', updatedAt: new Date() })
    .where(eq(tasks.id, task.id));
  return { deleted: false, removedMessages };
}

export async function countMessages(db: Db, taskId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.taskId, taskId));
  return row?.count ?? 0;
}

/** All tasks of a chat, newest first. Includes the task currently being recorded, if any. */
export async function listTasks(db: Db, chatId: number): Promise<Task[]> {
  return db.select().from(tasks).where(eq(tasks.chatId, chatId)).orderBy(desc(tasks.number));
}

export async function setTaskStatus(
  db: Db,
  taskId: number,
  status: Task['status'],
): Promise<Task | undefined> {
  const now = new Date();
  const [task] = await db
    .update(tasks)
    .set({ status, doneAt: status === 'done' ? now : null, updatedAt: now })
    .where(eq(tasks.id, taskId))
    .returning();
  return task;
}

/** Permanently removes a task and its messages (files are removed by the caller). */
export async function deleteTask(db: Db, taskId: number): Promise<boolean> {
  const deleted = await db.delete(tasks).where(eq(tasks.id, taskId)).returning({ id: tasks.id });
  return deleted.length > 0;
}

/**
 * Reopens a finished task for additions: starts a new edit round in "recording" state.
 * Fails with TaskAlreadyRecordingError when another task in the chat is recording.
 */
export async function startEdit(db: Db, task: Task): Promise<Task> {
  if (task.captureState !== 'none') throw new TaskAlreadyRecordingError(task);
  const other = await getCapturingTask(db, task.chatId);
  if (other) throw new TaskAlreadyRecordingError(other);
  try {
    const [updated] = await db
      .update(tasks)
      .set({
        captureState: 'edit',
        editRound: sql`${tasks.editRound} + 1`,
        controlMessageId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, task.id), eq(tasks.captureState, 'none')))
      .returning();
    if (!updated) throw new TaskAlreadyRecordingError(task);
    return updated;
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      const existing = await getCapturingTask(db, task.chatId);
      if (existing) throw new TaskAlreadyRecordingError(existing);
    }
    throw error;
  }
}
