import { describe, expect, it } from 'vitest';
import { createI18n } from '../../i18n.js';
import { buildHelpText, GROUP_COMMANDS, PRIVATE_COMMANDS } from './menu.js';

/** Every command the bot handles in groups must be offered in the menu and in /help. */
const HANDLED_GROUP_COMMANDS = [
  'new',
  'end',
  'cancel',
  'list',
  'show',
  'edit',
  'done',
  'undone',
  'delete',
  'help',
  'id',
  'register',
  'unregister',
];

describe('command menu', () => {
  it('offers every handled group command exactly once', () => {
    expect([...GROUP_COMMANDS].sort()).toEqual([...HANDLED_GROUP_COMMANDS].sort());
    expect(new Set(GROUP_COMMANDS).size).toBe(GROUP_COMMANDS.length);
    expect([...PRIVATE_COMMANDS]).toEqual(['start', 'help', 'id']);
  });

  it('lists the commands with their localized descriptions in /help', async () => {
    const i18n = await createI18n({ language: 'en', timeZone: 'UTC' });
    const help = buildHelpText(i18n.t, 'group');
    for (const command of HANDLED_GROUP_COMMANDS) {
      expect(help).toContain(`/${command} — ${i18n.t(`commands.${command}`)}`);
    }
    expect(buildHelpText(i18n.t, 'private')).not.toContain('/new');
  });
});
