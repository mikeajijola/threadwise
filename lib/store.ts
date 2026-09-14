import { get, put, list } from '@vercel/blob';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const prefix = 'callweave/';
function safe(key: string) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(key) || key.split('/').some(s => !s || s === '..' || s === '.')) throw Error('Invalid storage key');
  return key;
}
const local = (key: string) => resolve(process.env.DATA_DIRECTORY || '.data', safe(key));
const hosted = () => !!process.env.BLOB_READ_WRITE_TOKEN;
function check() { if (process.env.VERCEL && !hosted()) throw Error('Private Blob storage is not configured'); }
export async function read<T>(key: string): Promise<T | null> {
  check(); safe(key);
  if (hosted()) {
    const result = await get(prefix + key, { access: 'private', useCache: false });
    return result?.statusCode === 200 ? await new Response(result.stream).json() as T : null;
  }
  try { return JSON.parse(await readFile(local(key), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
export async function write(key: string, value: unknown) {
  check(); safe(key); const body = JSON.stringify(value);
  if (hosted()) { await put(prefix + key, body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' }); return; }
  const path = local(key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, body);
}
export async function keys(starts: string) {
  check(); safe(starts.replace(/\/$/, ''));
  if (hosted()) {
    const result: string[] = []; let cursor: string | undefined;
    do { const page = await list({ prefix: prefix + starts, cursor }); result.push(...page.blobs.map(b => b.pathname.slice(prefix.length))); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
    return result.sort();
  }
  const all: string[] = [];
  async function walk(dir: string, rel = '') {
    const entries = await readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    for (const e of entries) { const key = rel + e.name; if (e.isDirectory()) await walk(dir + '/' + e.name, key + '/'); else if (key.startsWith(starts)) all.push(key); }
  }
  await walk(resolve(process.env.DATA_DIRECTORY || '.data')); return all.sort();
}
