import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

export type Sql = postgres.Sql;

export function connect(url: string) {
  return postgres(url, {
    // bigint columns hold epoch milliseconds and byte counts, which fit safely in a JS number.
    types: { bigint: { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) } },
    onnotice: () => {},
  });
}

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

/** Applies pending `migrations/*.sql` files in name order, each in its own transaction. */
export async function migrate(sql: Sql) {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map(r => r.name));
  const files = (await readdir(MIGRATIONS)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(join(MIGRATIONS, file), 'utf8');
    await sql.begin(async tx => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
  }
}

/** Serialises a user's writes and pulls, so a pull never skips a rev that commits late. */
export const lockUser = (tx: postgres.TransactionSql, userId: string) => tx`select pg_advisory_xact_lock(hashtext(${userId}))`;
