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
- **Voice to text** — voice and audio messages are transcribed with OpenAI as they arrive;
  finishing a task waits for pending transcriptions.
- **AI titles** — when a task is finished, a short title in the configured language is
  generated from the whole conversation (falls back to the first line of text).
- **Task list** — `/list` shows all tasks, newest first, with their status.
- **Status** — `/done N` and `/undone N`.
- **Export** — `/show N` sends a zip with `task-N.md`, `task.json` and an `attachments/`
  folder, all in the configured language.
- **Edit** — `/edit N` reopens a task so more messages can be added; the title stays, and the
  additions appear under their own heading in the export.
- **Delete** — `/delete N` removes a task and its files after confirmation (owner only unless
  `ALLOW_MEMBER_DELETE=true`).
- **Multi-language** — all bot messages and exports come from `locales/*.json`. Seventeen
  languages are included (see [Languages](#languages)); adding one is a single JSON file.

## How it works

1. The owner adds the bot to a project group and sends `/register` there.
2. Anyone in the group sends `/new`. The task gets the next number for that group (`#1`, `#2`,
   ...) and the bot replies with a control message that has **Finish** and **Cancel** buttons.
3. Everything sent in the group is captured into the task (who said what, and when). Commands
   are not captured. Only one task per group can be recording at a time.
4. **Finish** closes the task: pending transcriptions complete and a title is generated.
   **Cancel** discards it together with its files. Finishing an empty recording discards it too.
5. Use `/list`, `/show N`, `/done N`, `/undone N` and `/delete N` to manage tasks.
6. `/edit N` reopens a finished task: everything sent until **Finish** is appended to it (the
   title is kept). **Cancel** discards only what was added during the edit.

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

### Export format

`/show 12` sends `task-12.zip`:

```
task-12.zip
├── task-12.md          human-readable export (metadata, conversation, attachment list)
├── task.json           the same data, structured, for scripts and integrations
└── attachments/
    ├── 001-photo.jpg
    ├── 002-voice.oga
    └── 003-spec.pdf
```

The Markdown file lists every message in order with author and time; voice messages include
their transcript, photos are embedded with relative links (they render in Obsidian, VS Code and
most Markdown viewers once the zip is extracted), and messages added with `/edit` appear under
their own heading. Labels and dates follow `BOT_LANGUAGE` and `TZ`. If the zip would exceed
Telegram's 50 MB upload limit, it is sent without the attachments and the bot says so.

## OpenAI

Set `OPENAI_API_KEY` to enable speech-to-text and AI titles. Without a key the bot still works:
voice messages are kept as audio files and the first line of text becomes the title.

- `OPENAI_MODEL` (default `gpt-4o-mini`) generates titles. Any chat model works.
- `OPENAI_TRANSCRIPTION_MODEL` (default `gpt-4o-transcribe`) transcribes voice and audio messages.
  `whisper-1` and `gpt-4o-mini-transcribe` are alternatives.
- `TRANSCRIPTION_LANGUAGE` is passed as a language hint. It defaults to `BOT_LANGUAGE`; set it to
  `auto` when people in your groups speak different languages.
- `OPENAI_BASE_URL` points the SDK at a proxy or an OpenAI-compatible provider.
- Transient errors are retried. If a transcription still fails, the voice message is kept without
  text and the bot says so in the group; if title generation fails, the fallback title is used.

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

## Deploying to a server

Two scripts automate the manual installation on a Debian/Ubuntu server. They are plain bash and
need nothing but SSH access.

### 1. Prepare the server (once)

`scripts/setup-server.sh` runs on the server as root. It installs Node.js 22, PM2 and PostgreSQL
when they are missing, creates a dedicated database role and database (`tlg_to_task` by default,
override with `DB_NAME` / `DB_USER`), writes `DATABASE_URL` with a generated password into
`<app dir>/.env` and registers PM2 to start on boot. It is idempotent.

```bash
# from your machine, in one go:
DEPLOY_HOST=bot.example.com scripts/deploy.sh --setup

# or on the server itself:
bash scripts/setup-server.sh /opt/tlg-to-task
```

### 2. Deploy (every release)

`scripts/deploy.sh` runs from your machine. It clones or updates the repository on the server,
optionally merges a local env file into the server's `.env`, installs dependencies, builds, takes
a `pg_dump` backup into `<app dir>/backups/` (the last ten are kept), and starts or reloads the
bot with PM2. Migrations run when the bot starts.

```bash
DEPLOY_HOST=bot.example.com \
DEPLOY_ENV_FILE=.env.production \
scripts/deploy.sh
```

| Variable          | Default                                          | Description                                                     |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `DEPLOY_HOST`     | required                                         | Server address.                                                 |
| `DEPLOY_USER`     | `root`                                           | SSH user.                                                       |
| `DEPLOY_PORT`     | `22`                                             | SSH port.                                                       |
| `DEPLOY_PASSWORD` |                                                  | SSH password (uses `sshpass`). Leave empty to use SSH keys.     |
| `DEPLOY_PATH`     | `/opt/tlg-to-task`                               | Application directory on the server.                            |
| `DEPLOY_REPO`     | `https://github.com/its-samzane/tlg-to-task.git` | Repository to clone (use your fork if you have one).            |
| `DEPLOY_BRANCH`   | `main`                                           | Branch to deploy.                                               |
| `DEPLOY_ENV_FILE` |                                                  | Local file whose variables are merged into the server's `.env`. |
| `SKIP_BACKUP`     |                                                  | Set to `1` to skip the database dump.                           |

The env file you upload only needs the variables you want to set or change (for example
`TELEGRAM_BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `OPENAI_API_KEY`, `BOT_LANGUAGE`, `TZ`); anything already
in the server's `.env`, such as the generated `DATABASE_URL`, is kept.

### Day-to-day

```bash
pm2 status                       # process state
pm2 logs tlg-to-task             # live logs
pm2 restart tlg-to-task          # restart after editing .env
```

To update, run `scripts/deploy.sh` again. To back up manually, dump the database with `pg_dump`
and copy the `storage/` directory, which holds all attachments.

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

| Code | Language               |
| ---- | ---------------------- |
| `en` | English                |
| `fa` | فارسی (Persian)        |
| `ar` | العربية (Arabic)       |
| `tr` | Türkçe (Turkish)       |
| `de` | Deutsch (German)       |
| `fr` | Français (French)      |
| `es` | Español (Spanish)      |
| `it` | Italiano (Italian)     |
| `pt` | Português (Portuguese) |
| `ru` | Русский (Russian)      |
| `uk` | Українська (Ukrainian) |
| `zh` | 简体中文 (Chinese)     |
| `ja` | 日本語 (Japanese)      |
| `ko` | 한국어 (Korean)        |
| `hi` | हिन्दी (Hindi)         |
| `ur` | اردو (Urdu)            |
| `id` | Bahasa Indonesia       |

The translations were written by the maintainers, not by native speakers of every language.
Corrections are welcome as pull requests.

### Adding a language

1. Copy `locales/en.json` to `locales/<code>.json`, where `<code>` is the ISO 639-1 code you will
   put in `BOT_LANGUAGE` (for example `nl`).
2. Fill in `_meta`: the native `name`, the `englishName` (used in the prompt that asks OpenAI for a
   title), the `intlLocale` used for date formatting (for example `nl-NL`) and `rtl`.
3. Translate every value. Keep the `{placeholders}`, the `<b>`/`<code>` tags and the command names
   (`/new`, `/register`, ...) exactly as they are. `\n` starts a new line.
4. Run `npm test`. A test checks that every locale has the same keys and placeholders as English
   and that `intlLocale` is valid.
5. Add the language to the table above and open a pull request.

Missing keys fall back to English at runtime, so a partially translated file still works.

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
