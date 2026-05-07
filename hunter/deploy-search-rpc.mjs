#!/usr/bin/env node
/**
 * Deploy the vector search RPC to Supabase using the pg module.
 * Usage: node hunter/deploy-search-rpc.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

// Load .env
const envPath = join(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const projectRef = (process.env.SUPABASE_URL || '').replace(/https:\/\/([^.]+).*/, '$1');
if (!projectRef) {
  console.error('SUPABASE_URL not set');
  process.exit(1);
}

// Read the SQL file
const sqlPath = join(import.meta.dirname, 'supabase-vector-search.sql');
const sql = readFileSync(sqlPath, 'utf8');
console.log(`SQL loaded (${sql.length} chars)`);

// Try direct connection via Supabase pooler
// Connection string format: postgresql://postgres.[ref]:[password]@[host]:6543/postgres
const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_SERVICE_KEY;

// Try different connection approaches
const hosts = [
  // Direct database connection
  { host: `db.${projectRef}.supabase.co`, port: 5432, user: 'postgres' },
  // Pooler connections (session mode on 5432, transaction mode on 6543)
  { host: `aws-0-us-east-1.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
  { host: `aws-0-us-east-1.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
];

let connected = false;

for (const conn of hosts) {
  console.log(`Trying ${conn.user}@${conn.host}:${conn.port}...`);

  const client = new pg.Client({
    user: conn.user,
    password: dbPassword,
    host: conn.host,
    port: conn.port,
    database: 'postgres',
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected! Executing SQL...');
    await client.query(sql);
    console.log('Done! search_corpus_embeddings function created + IVFFlat index built.');
    connected = true;
    await client.end();
    break;
  } catch (err) {
    console.log(`  Failed: ${err.message.slice(0, 100)}`);
    try { await client.end(); } catch {}
  }
}

if (!connected) {
  console.error('\nCould not connect to Supabase DB directly.');
  console.error('You may need to set SUPABASE_DB_PASSWORD in .env or run the SQL manually:');
  console.error('  1. Open Supabase dashboard → SQL Editor');
  console.error('  2. Paste contents of hunter/supabase-vector-search.sql');
  console.error('  3. Click Run');
  process.exit(1);
}
