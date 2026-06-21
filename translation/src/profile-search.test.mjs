// Locks the collaborator-search fix (db.js searchUserProfiles): a comma in the
// query (a "Last, First" name) used to corrupt the PostgREST `.or()` filter
// string and break the Share dialog's add-collaborator picker. The fix runs one
// scalar `.ilike()` per field and OR-combines in JS — a comma stays a literal
// part of a scalar pattern, never a separator.
//
// The query path is auth-gated (Johnny's session + RLS) and can't be driven
// headless, so this proves: (1) the pure planner/merge logic, (2) an inline RED
// proof that the OLD `.or()` string corrupts on a comma while the new plan does
// not, and (3) a source-binding assert that db.js actually wires the fix (no
// `.or(` left, planProfileSearch + mergeProfileMatches + `.ilike(` present).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  planProfileSearch,
  mergeProfileMatches,
  PROFILE_SEARCH_COLUMNS,
} from './profile-search.js';

const __dir = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ✗', name); }
}
function eq(name, a, b) { ok(name + ` (${JSON.stringify(a)} === ${JSON.stringify(b)})`, a === b); }

// ── Inline RED proof: the OLD `.or()` string corrupts on a comma ──────────────
// Reconstruct exactly what the buggy code built, and how PostgREST splits an
// `.or()` string into conditions (on commas). A comma in the VALUE creates
// extra, malformed conditions; the new plan keeps the comma literal.
function buildOldOrFilter(escaped) {
  return `display_name.ilike.%${escaped}%,email.ilike.%${escaped}%`;
}
function splitOrConditions(s) { return s.split(','); } // PostgREST splits on commas

{
  const escaped = 'Smith, John'; // escapeLikePattern leaves commas alone
  const oldConds = splitOrConditions(buildOldOrFilter(escaped));
  ok('RED: old .or() splits a comma value into >2 conditions', oldConds.length > 2);
  const malformed = oldConds.filter(c => !/\.ilike\./.test(c));
  ok('RED: old .or() produces malformed (no-operator) conditions', malformed.length > 0);

  const plan = planProfileSearch(escaped);
  eq('GREEN: new plan has exactly 2 scalar filters', plan.length, 2);
  ok('GREEN: each scalar pattern keeps the comma literal',
    plan.every(p => p.pattern.includes('Smith, John')));
  // The new patterns, treated as scalar values, do NOT split into >2 conditions
  ok('GREEN: a paren-bearing value also stays literal',
    planProfileSearch('(test)').every(p => p.pattern.includes('(test)')));
  ok('GREEN: a quote-bearing value also stays literal',
    planProfileSearch('a"b').every(p => p.pattern.includes('a"b')));
}

// ── planProfileSearch ─────────────────────────────────────────────────────────
{
  const plan = planProfileSearch('john');
  eq('plan: two entries', plan.length, 2);
  eq('plan: first column display_name', plan[0].column, 'display_name');
  eq('plan: second column email', plan[1].column, 'email');
  eq('plan: pattern wraps with % wildcards', plan[0].pattern, '%john%');
  eq('plan: both columns share the pattern', plan[1].pattern, '%john%');
  eq('plan: default columns export', PROFILE_SEARCH_COLUMNS.join(','), 'display_name,email');
  // custom columns
  const c = planProfileSearch('x', ['a', 'b', 'c']);
  eq('plan: custom columns length', c.length, 3);
  eq('plan: custom columns honored', c.map(p => p.column).join(','), 'a,b,c');
  // edge inputs
  eq('plan: empty string -> %% pattern', planProfileSearch('')[0].pattern, '%%');
  eq('plan: null -> %% pattern', planProfileSearch(null)[0].pattern, '%%');
  eq('plan: undefined -> %% pattern', planProfileSearch(undefined)[0].pattern, '%%');
  // already-escaped backslash value stays intact in the pattern
  ok('plan: escaped backslash preserved', planProfileSearch('a\\%b')[0].pattern === '%a\\%b%');
}

// ── mergeProfileMatches ───────────────────────────────────────────────────────
{
  const A = [{ user_id: '1', display_name: 'Ann' }, { user_id: '2', display_name: 'Bob' }];
  const B = [{ user_id: '2', email: 'bob@x.com' }, { user_id: '3', email: 'cara@x.com' }];

  const merged = mergeProfileMatches([A, B], 8);
  eq('merge: dedupes user_id 2 (matched both columns)', merged.length, 3);
  eq('merge: order preserved — A first', merged.map(r => r.user_id).join(','), '1,2,3');
  eq('merge: the kept #2 is from A (first set wins)', merged[1].display_name, 'Bob');

  // cap
  const capped = mergeProfileMatches([A, B], 2);
  eq('merge: caps to limit', capped.length, 2);
  eq('merge: cap keeps the earliest', capped.map(r => r.user_id).join(','), '1,2');

  // exact cap boundary
  eq('merge: cap == result count returns all', mergeProfileMatches([A], 2).length, 2);

  // empty / null sets
  eq('merge: empty resultSets -> []', mergeProfileMatches([], 8).length, 0);
  eq('merge: null resultSets -> []', mergeProfileMatches(null, 8).length, 0);
  eq('merge: null inner set skipped', mergeProfileMatches([null, A], 8).length, 2);
  eq('merge: empty inner sets -> []', mergeProfileMatches([[], []], 8).length, 0);

  // rows without user_id are kept (no dedupe key), not crash
  const noId = [{ display_name: 'x' }, { display_name: 'y' }];
  eq('merge: rows without user_id kept', mergeProfileMatches([noId], 8).length, 2);
  // null rows skipped
  eq('merge: null rows skipped', mergeProfileMatches([[null, { user_id: '9' }]], 8).length, 1);

  // limit guards
  eq('merge: limit 0 -> default 8', mergeProfileMatches([A, B], 0).length, 3);
  eq('merge: negative limit -> default 8', mergeProfileMatches([A, B], -5).length, 3);
  eq('merge: NaN limit -> default 8', mergeProfileMatches([A, B], NaN).length, 3);
  eq('merge: default limit (no arg) -> 8', mergeProfileMatches([A, B]).length, 3);
}

// ── Source-binding: db.js actually wires the fix ──────────────────────────────
{
  const dbSrc = readFileSync(join(__dir, 'db.js'), 'utf8');
  // strip line comments + block comments so a commented-out `.or(` can't fool us
  const code = dbSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

  // isolate the searchUserProfiles function body
  const start = code.indexOf('export async function searchUserProfiles');
  ok('source: searchUserProfiles exists', start >= 0);
  const body = code.slice(start, start + 900);

  ok('source: no .or( filter left in searchUserProfiles', !/\.or\(/.test(body));
  ok('source: calls planProfileSearch', /planProfileSearch\(/.test(body));
  ok('source: calls mergeProfileMatches', /mergeProfileMatches\(/.test(body));
  ok('source: uses scalar .ilike(', /\.ilike\(/.test(body));
  ok('source: imports from profile-search.js',
    /from '\.\/profile-search\.js'/.test(code));
}

console.log(`profile-search: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
