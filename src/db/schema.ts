import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Whether the task is currently collecting messages: a brand-new task, an edit round, or idle. */
export const captureStateEnum = pgEnum('capture_state', ['none', 'new', 'edit']);
/** User-facing completion status. */
export const taskStatusEnum = pgEnum('task_status', ['open', 'done']);
export const messageKindEnum = pgEnum('message_kind', [
  'text',
  'voice',
  'audio',
  'photo',
  'video',
  'video_note',
  'document',
  'sticker',
  'other',
]);
export const transcriptionStatusEnum = pgEnum('transcription_status', [
  'none',
  'pending',
  'done',
  'failed',
  'skipped',
]);

/** A Telegram group that the owner registered with /register. One group per project. */
export const chats = pgTable('chats', {
  chatId: bigint('chat_id', { mode: 'number' }).primaryKey(),
  title: text('title'),
  registeredByUserId: bigint('registered_by_user_id', { mode: 'number' }).notNull(),
  /** False after /unregister: the bot ignores the group but keeps its tasks. */
  active: boolean('active').notNull().default(true),
  /** Next per-chat task number, incremented atomically when a task is created. */
  nextTaskNumber: integer('next_task_number').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    chatId: bigint('chat_id', { mode: 'number' })
      .notNull()
      .references(() => chats.chatId, { onDelete: 'cascade' }),
    /** Human-facing number, unique per chat (#1, #2, ...). */
    number: integer('number').notNull(),
    title: text('title'),
    status: taskStatusEnum('status').notNull().default('open'),
    captureState: captureStateEnum('capture_state').notNull().default('new'),
    /** 0 while the task is first recorded; incremented for every /edit round. */
    editRound: integer('edit_round').notNull().default(0),
    /** Telegram message id of the bot's control message (the one with Finish/Cancel buttons). */
    controlMessageId: bigint('control_message_id', { mode: 'number' }),
    createdByUserId: bigint('created_by_user_id', { mode: 'number' }).notNull(),
    createdByName: text('created_by_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the task was first finished. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tasks_chat_number_idx').on(table.chatId, table.number),
    // Only one task per chat may be collecting messages at any time.
    uniqueIndex('tasks_one_capturing_per_chat_idx')
      .on(table.chatId)
      .where(sql`${table.captureState} <> 'none'`),
    index('tasks_chat_created_idx').on(table.chatId, table.createdAt),
  ],
);

/** Every Telegram message captured into a task, in the order it was sent. */
export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }).notNull(),
    fromUserId: bigint('from_user_id', { mode: 'number' }).notNull(),
    fromName: text('from_name').notNull(),
    kind: messageKindEnum('kind').notNull(),
    /** Message text, or the caption of a media message. */
    text: text('text'),
    transcript: text('transcript'),
    transcriptionStatus: transcriptionStatusEnum('transcription_status').notNull().default('none'),
    telegramFileId: text('telegram_file_id'),
    /** Path of the downloaded file, relative to STORAGE_DIR. */
    filePath: text('file_path'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    fileSize: integer('file_size'),
    durationSeconds: integer('duration_seconds'),
    /** Edit round in which the message was added (0 = original recording). */
    editRound: integer('edit_round').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_task_idx').on(table.taskId, table.sentAt, table.telegramMessageId)],
);

export type Chat = typeof chats.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
