/**
 * Nightly off-vendor backup of the script-tool data (Supabase → local Mac).
 *
 * Exports script_projects, script_docs, script_doc_revisions as gzipped JSONL
 * (one row per line — pages stream straight into the gzip so the ~200MB
 * revisions table never has to fit in memory as one JSON array), plus a full
 * recursive object listing of the script-images bucket, into
 * ~/Backups/mycoldmars/YYYY-MM-DD/. Prunes dated dirs older than 30 days.
 *
 * READ-ONLY by construction: the only Supabase calls are REST GETs and the
 * storage list endpoint (a POST in HTTP verb only — it cannot mutate).
 *
 * Run:      bun scripts/backup-script-data.ts
 * Schedule: ~/Library/LaunchAgents/com.johnnyharris.mycoldmars-backup.plist (03:30 nightly)
 * Log:      ~/Backups/mycoldmars/backup.log
 */
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync, appendFileSync, readFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BACKUP_ROOT = join(homedir(), 'Backups', 'mycoldmars');
const SECRETS_PATH = join(homedir(), '.config', 'mycoldmars', 'secrets.env');
const KEEP_DAYS = 30;
// Revisions rows average ~180KB — 500/page (~90MB/statement) trips Postgres's
// statement timeout (57014). Start here and let exportTable halve on timeout.
const PAGE_SIZE = 500;
const MIN_PAGE_SIZE = 10;
const BUCKET = 'script-images';

// ---------------------------------------------------------------------------
// pure helpers (exported for backup-script-data.test.mjs)
// ---------------------------------------------------------------------------

/** Parse a KEY=value env file. Handles `export KEY=`, quotes, comments, blank lines. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // strip one layer of matching quotes; values themselves never contain quotes here
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

/** Local (not UTC) date stamp — the LaunchAgent fires at 03:30 *local*, dirs should match. */
export function dateStamp(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Which dated backup dirs are older than keepDays relative to `today`?
 * Only exact YYYY-MM-DD names are candidates — anything else (backup.log,
 * launchd.log, stray files) is never pruned.
 */
export function dirsToPrune(names: string[], today: string, keepDays: number): string[] {
  const cutoff = new Date(today + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - keepDays);
  return names.filter((n) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n)) return false;
    const d = new Date(n + 'T00:00:00');
    return !Number.isNaN(d.getTime()) && d < cutoff;
  });
}

/** Keyset-paginated REST URL: rows strictly after `afterId`, ordered by id. */
export function pageUrl(base: string, table: string, afterId: number | null, pageSize: number): string {
  const cursor = afterId === null ? '' : `&id=gt.${afterId}`;
  return `${base}/rest/v1/${table}?select=*&order=id.asc${cursor}&limit=${pageSize}`;
}

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(join(BACKUP_ROOT, 'backup.log'), line + '\n'); } catch { /* dir may not exist yet on first lines */ }
}

function loadSecrets(): { url: string; key: string } {
  const env = parseEnvFile(readFileSync(SECRETS_PATH, 'utf8'));
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`SUPABASE_URL / SUPABASE_SERVICE_KEY missing from ${SECRETS_PATH}`);
  return { url: url.replace(/\/$/, ''), key };
}

async function sbFetch(url: string, key: string, init?: RequestInit): Promise<Response> {
  // one retry on transient network/5xx failures — nightly cron has no operator watching
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, {
        ...init,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
      if (r.status >= 500 && attempt === 1) { await Bun.sleep(3000); continue; }
      return r;
    } catch (e) {
      if (attempt === 1) { await Bun.sleep(3000); continue; }
      throw e;
    }
  }
}

/** Gzip-writer: rows go in as JSONL lines, file lands fully flushed on close(). */
function gzipFileWriter(path: string) {
  const gz = createGzip({ level: 6 });
  const out = createWriteStream(path);
  gz.pipe(out);
  return {
    write(line: string) {
      // respect backpressure so 200MB of revisions doesn't balloon the gzip buffer
      if (!gz.write(line)) return new Promise<void>((res) => gz.once('drain', () => res()));
      return Promise.resolve();
    },
    close(): Promise<void> {
      return new Promise((res, rej) => {
        out.on('finish', () => res());
        out.on('error', rej);
        gz.on('error', rej);
        gz.end();
      });
    },
  };
}

/**
 * Export one table as JSONL.gz via keyset pagination on `id`.
 * `idOf` extracts the cursor; script_docs has no id column so it pages by
 * project_id ordering instead (tiny table — a single offset page is fine, but
 * we keep the same code path by treating it as one unbounded page).
 */
async function exportTable(base: string, key: string, table: string, outPath: string): Promise<{ rows: number }> {
  const writer = gzipFileWriter(outPath);
  let rows = 0;
  let afterId: number | null = null;
  let pageSize = PAGE_SIZE;
  while (true) {
    const r = await sbFetch(pageUrl(base, table, afterId, pageSize), key);
    if (!r.ok) {
      const body = await r.text();
      // 57014 = statement timeout: the rows are too fat for this page size.
      // Halve and retry the SAME cursor — adaptive, so growth never breaks the nightly.
      if (body.includes('57014') && pageSize > MIN_PAGE_SIZE) {
        pageSize = Math.max(MIN_PAGE_SIZE, Math.floor(pageSize / 2));
        log(`${table}: statement timeout, retrying with page size ${pageSize}`);
        continue;
      }
      throw new Error(`${table} page failed: ${r.status} ${body.slice(0, 300)}`);
    }
    const page = (await r.json()) as Array<Record<string, unknown>>;
    for (const row of page) await writer.write(JSON.stringify(row) + '\n');
    rows += page.length;
    if (page.length < pageSize) break;
    afterId = page[page.length - 1].id as number;
    if (afterId == null) throw new Error(`${table}: keyset cursor missing after ${rows} rows`);
  }
  await writer.close();
  return { rows };
}

/** script_docs is keyed by project_id (no id column) — offset paging over a 6-row table. */
async function exportDocsTable(base: string, key: string, outPath: string): Promise<{ rows: number }> {
  const writer = gzipFileWriter(outPath);
  let rows = 0;
  let offset = 0;
  while (true) {
    const url = `${base}/rest/v1/script_docs?select=*&order=project_id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    const r = await sbFetch(url, key);
    if (!r.ok) throw new Error(`script_docs page failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
    const page = (await r.json()) as Array<Record<string, unknown>>;
    for (const row of page) await writer.write(JSON.stringify(row) + '\n');
    rows += page.length;
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  await writer.close();
  return { rows };
}

/** Recursively list every object in the bucket (the list API is per-folder). */
async function listBucket(base: string, key: string, prefix = ''): Promise<Array<Record<string, unknown>>> {
  const objects: Array<Record<string, unknown>> = [];
  let offset = 0;
  while (true) {
    const r = await sbFetch(`${base}/storage/v1/object/list/${BUCKET}`, key, {
      method: 'POST', // list endpoint only — cannot mutate
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`storage list "${prefix}" failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
    const entries = (await r.json()) as Array<Record<string, unknown>>;
    for (const e of entries) {
      const path = prefix ? `${prefix}/${e.name}` : String(e.name);
      if (e.id === null) {
        // folders come back with id:null — recurse into them
        objects.push(...(await listBucket(base, key, path)));
      } else {
        objects.push({ ...e, path });
      }
    }
    if (entries.length < 1000) break;
    offset += 1000;
  }
  return objects;
}

function pruneOld(today: string) {
  let names: string[] = [];
  try { names = readdirSync(BACKUP_ROOT); } catch { return; }
  for (const dir of dirsToPrune(names, today, KEEP_DAYS)) {
    rmSync(join(BACKUP_ROOT, dir), { recursive: true, force: true });
    log(`pruned old backup ${dir}`);
  }
}

function bytesOf(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

async function main() {
  const today = dateStamp(new Date());
  const dayDir = join(BACKUP_ROOT, today);
  mkdirSync(dayDir, { recursive: true });
  log(`backup start → ${dayDir}`);

  const { url, key } = loadSecrets();
  const results: string[] = [];

  for (const table of ['script_projects', 'script_doc_revisions'] as const) {
    const out = join(dayDir, `${table}.jsonl.gz`);
    const { rows } = await exportTable(url, key, table, out);
    results.push(`${table}: ${rows} rows, ${bytesOf(out)} bytes gz`);
    log(results[results.length - 1]);
  }

  {
    const out = join(dayDir, 'script_docs.jsonl.gz');
    const { rows } = await exportDocsTable(url, key, out);
    results.push(`script_docs: ${rows} rows, ${bytesOf(out)} bytes gz`);
    log(results[results.length - 1]);
  }

  {
    const out = join(dayDir, 'script-images-listing.json.gz');
    const objects = await listBucket(url, key);
    const writer = gzipFileWriter(out);
    await writer.write(JSON.stringify({ bucket: BUCKET, listed_at: new Date().toISOString(), count: objects.length, objects }, null, 2));
    await writer.close();
    results.push(`script-images listing: ${objects.length} objects, ${bytesOf(out)} bytes gz`);
    log(results[results.length - 1]);
  }

  pruneOld(today);
  log(`backup complete: ${results.join(' | ')}`);
}

if (import.meta.main) {
  main().catch((e) => {
    log(`BACKUP FAILED: ${e?.message ?? e}`);
    process.exit(1);
  });
}
