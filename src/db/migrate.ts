import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';
import type * as schema from './schema.js';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url));

export async function runMigrations(db: NodePgDatabase<typeof schema>): Promise<void> {
  await migrate(db, { migrationsFolder });
}

// Allows `npm run db:migrate` to apply migrations without starting the bot.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { loadConfig } = await import('../config.js');
  const config = loadConfig();
  const handle = createDb(config.DATABASE_URL);
  try {
    await runMigrations(handle.db);
    console.log('Migrations applied.');
  } finally {
    await handle.close();
  }
}
