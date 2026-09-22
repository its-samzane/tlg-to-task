import type { Bot } from 'grammy';
import type { AppContext, Deps } from '../context.js';

/** Commands offered in private chats, in menu order. Descriptions live in the locales. */
export const PRIVATE_COMMANDS = ['start', 'help', 'id'] as const;

/** Commands offered in groups, in menu order. */
export const GROUP_COMMANDS = [
  'new',
  'end',
  'cancel',
  'help',
  'id',
  'register',
  'unregister',
] as const;

export type CommandScope = 'private' | 'group';

export function buildHelpText(t: AppContext['t'], scope: CommandScope): string {
  const commands: readonly string[] = scope === 'private' ? PRIVATE_COMMANDS : GROUP_COMMANDS;
  const lines = commands
    .filter((command) => command !== 'start')
    .map((command) => `/${command} — ${t(`commands.${command}`)}`);
  return t('help.text', { commands: lines.join('\n') });
}

/** Publishes the command menus (the "/" button in Telegram) using the configured language. */
export async function applyCommandMenu(bot: Bot<AppContext>, deps: Deps): Promise<void> {
  const describe = (commands: readonly string[]) =>
    commands.map((command) => ({
      command,
      description: deps.i18n.t.raw(`commands.${command}`),
    }));
  await bot.api.setMyCommands(describe(PRIVATE_COMMANDS), {
    scope: { type: 'all_private_chats' },
  });
  await bot.api.setMyCommands(describe(GROUP_COMMANDS), { scope: { type: 'all_group_chats' } });
  await bot.api.setMyCommands(describe(GROUP_COMMANDS), {
    scope: { type: 'all_chat_administrators' },
  });
}
