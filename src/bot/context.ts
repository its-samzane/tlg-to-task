import type { Context } from 'grammy';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { I18n, Translate } from '../i18n.js';
import type { Logger } from '../logger.js';

export interface Deps {
  config: Config;
  db: Db;
  i18n: I18n;
  logger: Logger;
}

export type AppContext = Context & {
  deps: Deps;
  t: Translate;
};
