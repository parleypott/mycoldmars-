// Tests for the qss-scene-detect upsert path — the scene-illustration
// pipeline's write step. The bug this locks: the scene upsert hit the
// qss_story_scenes unique constraint (story_id, scene_index) on a force
// re-detect because it ran a plain INSERT — it never requested
// PostgREST's `resolution=merge-duplicates`, so the on_conflict target
// was ignored and a re-run 409'd. The fix routes every scene write
// through upsertScene(), which pairs on_conflict with merge-duplicates.
//
// Imports the REAL shipped module (no drift-prone mirror). Run with bun
// (auto-discovered by `bun run test`).

import {
  sb,
  upsertScene,
  SCENE_UPSERT_PATH,
  SCENE_UPSERT_PREFER,
} from './qss-scene-detect.js';

let pass = 0;
let fail = 0;
const fails = [];
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); }
}

// ── The fix itself: the upsert prefer must request merge-duplicates ──
// (Revert the fix → these go RED. This is the mutation proof.)
check('SCENE_UPSERT_PREFER requests resolution=merge-duplicates',
  /resolution=merge-duplicates/.test(SCENE_UPSERT_PREFER));
check('SCENE_UPSERT_PREFER still returns the representation',
  /return=representation/.test(SCENE_UPSERT_PREFER));
check('SCENE_UPSERT_PATH targets the (story_id, scene_index) conflict key',
  SCENE_UPSERT_PATH.includes('on_conflict=story_id,scene_index'));
check('SCENE_UPSERT_PATH is the qss_story_scenes table',
  SCENE_UPSERT_PATH.startsWith('qss_story_scenes?'));

// ── The call site: upsertScene must pass the conflict resolution to sb ──
// Inject a fake sb to capture exactly what the call site requests. This
// pins the behavior independently of the constant, so removing the opts
// at the call site (the other way to reintroduce the bug) also goes RED.
{
  let captured = null;
  const fakeSb = (method, path, body, opts) => {
    captured = { method, path, body, opts };
    return Promise.resolve('ok');
  };
  const row = { story_id: 'abc', scene_index: 0, title: 'X' };
  const ret = await upsertScene(row, fakeSb);

  check('upsertScene returns whatever sb returns', ret === 'ok');
  check('upsertScene POSTs', captured && captured.method === 'POST');
  check('upsertScene hits the conflict path', captured && captured.path === SCENE_UPSERT_PATH);
  check('upsertScene forwards the row unchanged', captured && captured.body === row);
  check('upsertScene requests merge-duplicates (the fix)',
    captured && captured.opts && /resolution=merge-duplicates/.test(captured.opts.prefer));
}

// ── sb() honors an opts.prefer override and defaults sensibly ──
// Stub global.fetch to capture the outgoing request headers.
{
  const realFetch = global.fetch;
  let lastReq = null;
  global.fetch = (url, init) => {
    lastReq = { url, init };
    return Promise.resolve(new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  };
  try {
    // default prefer
    await sb('GET', 'qss_story_scenes?select=*');
    check('sb default Prefer is return=representation',
      lastReq.init.headers.Prefer === 'return=representation');
    check('sb sends apikey + auth headers',
      'apikey' in lastReq.init.headers && /^Bearer/.test(lastReq.init.headers.Authorization));

    // overridden prefer (the upsert case)
    await sb('POST', SCENE_UPSERT_PATH, { a: 1 }, { prefer: SCENE_UPSERT_PREFER });
    check('sb override Prefer carries merge-duplicates',
      /resolution=merge-duplicates/.test(lastReq.init.headers.Prefer));
    check('sb serializes the body to JSON',
      lastReq.init.body === JSON.stringify({ a: 1 }));
    check('sb POSTs to the rest/v1 path',
      lastReq.url.includes('/rest/v1/' + SCENE_UPSERT_PATH));

    // GET with no body sends no body
    lastReq = null;
    await sb('GET', 'qss_story_scenes?select=id');
    check('sb omits body when none given', lastReq.init.body === undefined);
  } finally {
    global.fetch = realFetch;
  }
}

// ── Inline RED proof: the OLD call site (no opts) loses the resolution ──
// Reconstruct the pre-fix behavior and show it would NOT request
// merge-duplicates, which is what caused the 409 on re-detect.
{
  let captured = null;
  const fakeSb = (method, path, body, opts) => { captured = opts; return Promise.resolve('ok'); };
  // pre-fix call site: sb('POST', path, row)  → opts undefined
  await (async (row) => fakeSb('POST', SCENE_UPSERT_PATH, row))({ story_id: 'z', scene_index: 1 });
  check('RED proof: pre-fix call site sent no prefer (would 409 on re-detect)',
    captured === undefined);
}

console.log(`qss-scene-detect: ${pass} passed, ${fail} failed`);
if (fail) {
  console.error('FAILURES:\n  ' + fails.join('\n  '));
  process.exit(1);
}
