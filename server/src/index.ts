import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connect, migrate } from './db.js';
import { createStorage } from './storage.js';

const config = loadConfig();
const sql = connect(config.databaseUrl);
await migrate(sql);
const storage = await createStorage(config.s3);
const app = await buildApp({ config, sql, storage });

await app.listen({ port: config.port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await sql.end();
    process.exit(0);
  });
}
