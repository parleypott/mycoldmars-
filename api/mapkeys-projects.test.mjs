/**
 * MapKeys projects API — pure-validator coverage. Pins:
 *   1. validateCreateBody: slug shape (lowercase alnum+hyphen, ≤60, not
 *      reserved), name required (≤200), folder_id uuid-or-null, state object.
 *   2. buildPatch: whitelist only (name/slug/folder_id/state/trashed_at),
 *      trashed_at ISO-or-null, at least one field, unknown keys dropped.
 *   3. validateState: plain-object gate + the 4MB byte cap.
 *
 * Run: bun api/mapkeys-projects.test.mjs  (or: bun run test)
 */
import {
  validateCreateBody, buildPatch, validateState,
  SLUG_RE, RESERVED_SLUGS, MAX_STATE_BYTES,
} from './mapkeys-projects.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

const FOLDER = '123e4567-e89b-42d3-a456-426614174000';

// ── validateCreateBody ──────────────────────────────────────────────────────
{
  const good = validateCreateBody({ slug: 'taiwan-strait', name: 'Taiwan Strait', folder_id: FOLDER, state: { shapes: [] } });
  ok(good.ok, 'a well-formed create body passes');
  eq(good.slug, 'taiwan-strait', 'slug rides through');
  eq(good.folder_id, FOLDER, 'folder_id rides through');

  ok(!validateCreateBody(null).ok, 'null body refused');
  ok(!validateCreateBody({ slug: '', name: 'X' }).ok, 'empty slug refused');
  ok(!validateCreateBody({ slug: 'Has-Caps', name: 'X' }).ok, 'uppercase slug refused');
  ok(!validateCreateBody({ slug: '-leading', name: 'X' }).ok, 'leading hyphen refused');
  ok(!validateCreateBody({ slug: 'a'.repeat(61), name: 'X' }).ok, 'slug >60 refused');
  ok(!validateCreateBody({ slug: 'ok-slug', name: '' }).ok, 'empty name refused');
  ok(!validateCreateBody({ slug: 'ok-slug', name: 'X', folder_id: 'not-a-uuid' }).ok, 'malformed folder_id refused');
  const nullFolder = validateCreateBody({ slug: 'ok-slug', name: 'X', folder_id: null });
  ok(nullFolder.ok && nullFolder.folder_id === null, 'null folder_id allowed (unfiled)');
  ok(!validateCreateBody({ slug: 'ok-slug', name: 'X', state: [1, 2] }).ok, 'array state refused');

  for (const r of RESERVED_SLUGS) {
    ok(!validateCreateBody({ slug: r, name: 'X' }).ok, `reserved slug "${r}" refused`);
  }
}

// ── buildPatch ──────────────────────────────────────────────────────────────
{
  ok(!buildPatch({}).ok, 'empty patch refused (no fields)');
  ok(!buildPatch(null).ok, 'null patch refused');

  const rename = buildPatch({ name: '  Burma routes  ', slug: 'burma-routes' });
  ok(rename.ok, 'rename patch passes');
  eq(rename.fields.name, 'Burma routes', 'name is trimmed');

  ok(!buildPatch({ name: '   ' }).ok, 'whitespace-only name refused');
  ok(!buildPatch({ slug: 'library' }).ok, 'reserved slug refused in patch');

  const move = buildPatch({ folder_id: null });
  ok(move.ok && move.fields.folder_id === null, 'move to no-folder passes');
  ok(!buildPatch({ folder_id: 'garbage' }).ok, 'malformed folder_id refused in patch');

  const trash = buildPatch({ trashed_at: '2026-07-07T00:00:00.000Z' });
  ok(trash.ok, 'trash stamp passes');
  const restore = buildPatch({ trashed_at: null });
  ok(restore.ok && restore.fields.trashed_at === null, 'restore (null) passes');
  ok(!buildPatch({ trashed_at: 42 }).ok, 'numeric trashed_at refused');

  const sneaky = buildPatch({ name: 'X', created_at: 'nope', id: 'nope' });
  ok(sneaky.ok, 'patch with extra keys still passes on the whitelisted field');
  eq(Object.keys(sneaky.fields), ['name'], 'unknown keys are dropped, never forwarded');
}

// ── validateState ───────────────────────────────────────────────────────────
{
  ok(validateState({}).ok, 'empty object state passes');
  ok(validateState({ shapes: [], camera: { center: [0, 0] } }).ok, 'editor snapshot passes');
  ok(!validateState([]).ok, 'array refused');
  ok(!validateState('x').ok, 'string refused');
  ok(!validateState(null).ok, 'null refused');

  const big = { blob: 'x'.repeat(MAX_STATE_BYTES) };
  const r = validateState(big);
  ok(!r.ok && r.code === 'STATE_TOO_BIG', 'over-cap state refused with STATE_TOO_BIG');
}

// ── slug regex sanity ───────────────────────────────────────────────────────
{
  ok(SLUG_RE.test('a'), 'single char slug ok');
  ok(SLUG_RE.test('two-words'), 'hyphenated slug ok');
  ok(!SLUG_RE.test('double--hyphen'), 'double hyphen refused');
  ok(!SLUG_RE.test('trailing-'), 'trailing hyphen refused');
}

console.log(`mapkeys-projects: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join('\n')); process.exit(1); }
