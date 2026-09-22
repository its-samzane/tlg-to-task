CREATE TYPE "public"."capture_state" AS ENUM('none', 'new', 'edit');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'voice', 'audio', 'photo', 'video', 'video_note', 'document', 'sticker', 'other');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TYPE "public"."transcription_status" AS ENUM('none', 'pending', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "chats" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"title" text,
	"registered_by_user_id" bigint NOT NULL,
	"next_task_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"telegram_message_id" bigint NOT NULL,
	"from_user_id" bigint NOT NULL,
	"from_name" text NOT NULL,
	"kind" "message_kind" NOT NULL,
	"text" text,
	"transcript" text,
	"transcription_status" "transcription_status" DEFAULT 'none' NOT NULL,
	"telegram_file_id" text,
	"file_path" text,
	"file_name" text,
	"mime_type" text,
	"file_size" integer,
	"duration_seconds" integer,
	"edit_round" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"capture_state" "capture_state" DEFAULT 'new' NOT NULL,
	"edit_round" integer DEFAULT 0 NOT NULL,
	"control_message_id" bigint,
	"created_by_user_id" bigint NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_chat_id_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_task_idx" ON "messages" USING btree ("task_id","sent_at","telegram_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_chat_number_idx" ON "tasks" USING btree ("chat_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_one_capturing_per_chat_idx" ON "tasks" USING btree ("chat_id") WHERE "tasks"."capture_state" <> 'none';--> statement-breakpoint
CREATE INDEX "tasks_chat_created_idx" ON "tasks" USING btree ("chat_id","created_at");