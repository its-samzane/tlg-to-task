# tlg-to-task

A Telegram bot that turns group conversations into structured tasks.

Create one Telegram group per project, add the bot, and let your clients talk. When someone
starts a task with `/new`, every message that follows (text, voice, photos, videos, files) from
anyone in the group is captured into that task until it is finished. Voice messages are
transcribed and a short title is generated with OpenAI. Tasks can be listed, marked done,
edited, exported as a zip (Markdown + attachments) and deleted.

The bot speaks the language you configure (`BOT_LANGUAGE`) and records tasks in it.

> **Status:** under active development. Commands marked _planned_ below are not available yet.

## Features

- **Task recording** — `/new` starts a task; all following messages from all members are
  recorded with author and time. Finish or cancel with inline buttons (or `/end`, `/cancel`).
- **Attachments** — photos, videos, voice messages and files are downloaded and kept with the
  task (up to Telegram's 20 MB download limit).
- **Voice to text** _(planned)_ — voice and audio messages are transcribed with OpenAI.
- **AI titles** _(planned)_ — a short title is generated from the whole conversation.
- **Task list** _(planned)_ — `/list` shows all tasks, newest first, with their status.
- **Status** _(planned)_ — `/done N` and `/undone N`.
- **Export** _(planned)_ — `/show N` sends a zip with `task-N.md`, `task.json` and an
  `attachments/` folder.
- **Edit** _(planned)_ — `/edit N` reopens a task so more messages can be added.
- **Delete** _(planned)_ — `/delete N` removes a task and its files (with confirmation).
- **Multi-language** — all bot messages and exports come from `locales/*.json`; English and
  Persian are included, more languages are on the way.

## How it works

1. The owner adds the bot to a project group and sends `/register` there.
2. Anyone in the group sends `/new`. The task gets the next number for that group (`#1`, `#2`,
   ...) and the bot replies with a control message that has **Finish** and **Cancel** buttons.
3. Everything sent in the group is captured into the task (who said what, and when). Commands
   are not captured. Only one task per group can be recording at a time.
4. **Finish** closes the task: pending transcriptions complete and a title is generated.
   **Cancel** discards it together with its files. Finishing an empty recording discards it too.
5. Use `/list`, `/show N`, `/done N`, `/undone N`, `/edit N` and `/delete N` to manage tasks.

### Commands

| Command       | Where   | Who        | What it does                                            |
| ------------- | ------- | ---------- | ------------------------------------------------------- |
| `/start`      | private | anyone     | Introduction; shows your numeric user id.               |
| `/help`       | both    | anyone     | Lists the available commands.                           |
| `/id`         | both    | anyone     | Shows your user id and the chat id.                     |
| `/register`   | group   | owner      | Activates the bot in the group.                         |
| `/unregister` | group   | owner      | Deactivates the bot in the group; tasks are kept.       |
| `/new`        | group   | any member | Starts recording a new task.                            |
| `/end`        | group   | any member | Finishes the recording (same as the **Finish** button). |
| `/cancel`     | group   | any member | Discards the recording (same as the **Cancel** button). |

Attachments are stored under `STORAGE_DIR/tasks/<task id>/` with numbered names such as
`001-photo.jpg` or `002-spec.pdf`.

## Requirements

- Node.js 22 or newer
- PostgreSQL 14 or newer
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An OpenAI API key (optional, needed for transcription and AI titles)

## Quick start with Docker Compose

```bash
git clone https://github.com/its-samzane/tlg-to-task.git
cd tlg-to-task
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID, OPENAI_API_KEY, ...
docker compose up -d --build
docker compose logs -f bot
```

`docker-compose.yml` starts PostgreSQL alongside the bot and stores attachments in `./storage`.
`DATABASE_URL` and `STORAGE_DIR` are set by the compose file, the rest comes from `.env`.

## Manual installation (Node.js + PM2)

```bash
git clone https://github.com/its-samzane/tlg-to-task.git
cd tlg-to-task
npm ci
cp .env.example .env      # fill in the values; DATABASE_URL must point to your PostgreSQL
npm run build
npm start                 # or: pm2 start ecosystem.config.cjs && pm2 save
```

Database migrations run automatically when the bot starts. To apply them without starting the
bot, run `npm run db:migrate`.

## Telegram setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token into
   `TELEGRAM_BOT_TOKEN`.
2. Send `/start` to your bot in a private chat. It replies with your numeric user id; put it in
   `OWNER_TELEGRAM_ID`.
3. Add the bot to a group. The bot must be able to read all messages in the group: either make it
   an **admin** of the group or disable **Group Privacy** for the bot in BotFather
   (`/mybots` → Bot Settings → Group Privacy → Turn off).
4. Send `/register` in the group (owner only). The group is now active.

## Configuration

All settings are read from environment variables (or a `.env` file in the project root).
See [`.env.example`](.env.example) for a commented template.

| Variable                     | Required | Default                | Description                                                            |
| ---------------------------- | -------- | ---------------------- | ---------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`         | yes      |                        | Bot token from BotFather.                                              |
| `OWNER_TELEGRAM_ID`          | yes      |                        | Numeric Telegram user id of the bot owner.                             |
| `DATABASE_URL`               | yes      |                        | PostgreSQL connection string.                                          |
| `OPENAI_API_KEY`             | no       |                        | Enables voice transcription and AI titles.                             |
| `OPENAI_MODEL`               | no       | `gpt-4o-mini`          | Chat model used for task titles.                                       |
| `OPENAI_TRANSCRIPTION_MODEL` | no       | `gpt-4o-transcribe`    | Speech-to-text model.                                                  |
| `OPENAI_BASE_URL`            | no       |                        | Custom API base URL (proxy or compatible provider).                    |
| `BOT_LANGUAGE`               | no       | `en`                   | Language of bot messages and exports. Must match a file in `locales/`. |
| `TRANSCRIPTION_LANGUAGE`     | no       | same as `BOT_LANGUAGE` | Language hint for speech-to-text; `auto` disables the hint.            |
| `TZ`                         | no       | `UTC`                  | IANA time zone used for dates.                                         |
| `STORAGE_DIR`                | no       | `./storage`            | Where attachments are stored.                                          |
| `ALLOW_MEMBER_DELETE`        | no       | `false`                | Let any group member delete tasks (default: owner only).               |
| `LOG_LEVEL`                  | no       | `info`                 | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.        |

## Languages

Set `BOT_LANGUAGE` to one of the codes below. The bot uses that language for every message it
sends, for the Markdown export, for the AI-generated titles and (unless overridden) as the hint
for speech-to-text. Dates are formatted with the locale's calendar, so Persian uses the Solar
Hijri calendar.

| Code | Language        |
| ---- | --------------- |
| `en` | English         |
| `fa` | فارسی (Persian) |

More languages are being added. To add one yourself, copy `locales/en.json` to
`locales/<code>.json`, translate the values (keep the `{placeholders}`), fill in `_meta` and run
`npm test` — a test checks that every locale has exactly the same keys as English.

## Development

```bash
npm install
cp .env.example .env
npm run dev          # start with hot reload and pretty logs
npm test             # unit tests (use an in-memory PostgreSQL via PGlite, no server needed)
npm run lint
npm run typecheck
npm run db:generate  # generate a migration after changing src/db/schema.ts
```

### Project structure

```
src/
  index.ts          entry point: config → database → bot
  config.ts         environment parsing and validation
  i18n.ts           locale loading, translation and date formatting
  db/               Drizzle schema, client and migrations
  services/         database operations, file storage, background work
  bot/              grammY bot, commands, recording flow and message capture
  test/             helpers: in-memory database, fake Telegram API, update builders
locales/            one JSON file per language
drizzle/            generated SQL migrations
```

## License

[MIT](LICENSE)
