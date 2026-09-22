import type { Bot } from 'grammy';
import type { AppContext } from '../context.js';

/** Commands shown in Telegram's command menu, in display order. Descriptions live in the locales. */
export const COMMANDS = ['start', 'help', 'id'] as const;

export function buildHelpText(t: AppContext['t']): string {
  const lines = COMMANDS.filter((command) => command !== 'start').map(
    (command) => `/${command} — ${t(`commands.${command}`)}`,
  );
  return t('help.text', { commands: lines.join('\n') });
}

export function registerBasicCommands(bot: Bot<AppContext>): void {
  bot.command('start', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(ctx.t('start.private', { userId: ctx.from?.id ?? '' }), {
        parse_mode: 'HTML',
      });
      return;
    }
    await ctx.reply(ctx.t('start.group'), { parse_mode: 'HTML' });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(buildHelpText(ctx.t), { parse_mode: 'HTML' });
  });

  bot.command('id', async (ctx) => {
    await ctx.reply(ctx.t('id.text', { userId: ctx.from?.id ?? '', chatId: ctx.chat.id }), {
      parse_mode: 'HTML',
    });
  });
}
