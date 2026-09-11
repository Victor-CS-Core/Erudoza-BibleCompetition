// Shared by local fixtures and tests. Remote migrations remain Wrangler-managed.
import { readFile, readdir } from 'node:fs/promises';
import { URL } from 'node:url';

export async function readNativeMigrations() {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
  return Promise.all(files.map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { name, sql, statements: sql.split(';').filter(statement => statement.trim()) };
  }));
}
