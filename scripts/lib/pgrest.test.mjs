// Lock pgTsFilter — the single encoded PostgREST timestamp-filter builder shared
// by the DevChat fixer's Supabase REST calls. The load-bearing contract: a DB
// timestamptz value (which serializes WITH a "+00:00" offset) must have its '+'
// percent-encoded, or PostgREST decodes the '+' to a space and 400s the request
// as an invalid timestamp (22007) — silently breaking the fort's DevChat poll.
import assert from 'node:assert/strict';
import { pgTsFilter } from './pgrest.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

// ── the bug this exists to prevent: a raw "+00:00" offset in the query value ──
const dbTs = '2026-06-30T12:34:56.789123+00:00';
const clause = pgTsFilter('created_at', 'gt', dbTs);
ok(!clause.includes('+'), 'a DB "+00:00" timestamp must not leave a raw + in the clause');
ok(clause.includes('%2B'), 'the + offset must be percent-encoded as %2B');
ok(clause.includes('%3A'), 'the : separators must be percent-encoded as %3A');
eq(clause, 'created_at=gt.2026-06-30T12%3A34%3A56.789123%2B00%3A00', 'full encoded clause');

// round-trips: decoding the value back yields the original timestamp
const value = clause.slice('created_at=gt.'.length);
eq(decodeURIComponent(value), dbTs, 'decoded value equals the original timestamp');

// PostgREST's own '+'→space decoding must NOT corrupt our value (the actual bug)
eq(value.replace(/\+/g, ' '), value, 'no bare + for PostgREST to turn into a space');

// ── shape: col / op wiring is correct and not swapped ──
eq(pgTsFilter('created_at', 'gt', '2026-01-01T00:00:00Z'),
   'created_at=gt.2026-01-01T00%3A00%3A00Z', 'Z-suffixed (toISOString) timestamp');
eq(pgTsFilter('deleted_at', 'lte', '2026-01-01T00:00:00Z'),
   'deleted_at=lte.2026-01-01T00%3A00%3A00Z', 'op and column are honored, not hardcoded');

// coerces non-string input rather than throwing
eq(pgTsFilter('created_at', 'gt', 0), 'created_at=gt.0', 'numeric input coerced');

console.log(`pgrest.test.mjs: ${n} assertions passed`);
