// GUEST GATE CONTRACT — Google-Docs link sharing through the Script Library door.
//
// The laws this suite pins (unit tests where the code is pure; source scans where the decision
// lives in boot wiring, exactly like burma-script's read-gates-contract.test.mjs):
//
//   1. resolvePublicProject is the ONLY network read a guest boot makes: it calls the SCOPED
//      ?slug= endpoint, only ever GETs, and degrades to null on every failure shape.
//   2. rowForGuest shapes the wire row so configForProject mounts the right engine config
//      (cloud UUID id → script_<id>_* namespace + /api/script-doc?project=<id>; legacy episode
//      pins ride through).
//   3. read-mode's forceReadOnly latch is ONE-WAY (can force read-only on, never off) and the
//      guest boot latches it BEFORE the engine imports.
//   4. boot.jsx: the guest branch never touches the library (no mountLibrary/openProject), never
//      writes (no touchProject / startPresence / injectMastheadRename), and the #library route
//      for a guest still goes through ensureUnlocked (the sign-in wall).
//   5. guest.js contains ZERO write verbs — a guest session cannot originate a cloud write from
//      this layer at all.
//
// Run: bun scripts-library/src/guest-gate-contract.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { resolvePublicProject, rowForGuest } from './guest.js';
import { isReadOnly, forceReadOnly, __setReadOnlyForTest } from '../../burma-script/src/read-mode.js';
import { configForProject } from './config-for-project.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const bootSrc = readFileSync(join(HERE, 'boot.jsx'), 'utf8');
const guestSrc = readFileSync(join(HERE, 'guest.js'), 'utf8');
const gateSrc = readFileSync(join(HERE, 'gate.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);

/* ── 1. resolvePublicProject — scoped, GET-only, fail-null ───────────────────── */
{
  const calls = [];
  const mkFetch = (payload, status = 200) => async (url, init = {}) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' });
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  };

  const row = { id: 'aaaaaaaa-0000-4000-8000-000000000001', slug: 'nile-river', title: 'Nile', episode: null, updated_at: '2026-07-20T00:00:00Z' };
  const got = await resolvePublicProject('nile-river', mkFetch({ project: row }));
  ok(got && got.id === row.id, 'resolves a public row');
  eq(calls.length, 1, 'exactly one network call');
  ok(calls[0].url.startsWith('/api/script-projects?slug='), 'calls the SCOPED ?slug= endpoint');
  ok(calls[0].url.includes('slug=nile-river'), 'carries the slug');
  eq(calls[0].method, 'GET', 'read is a GET — a guest resolution can never write');
  ok(!calls.some((c) => c.url === '/api/script-projects'), 'NEVER the bare list endpoint');

  eq(await resolvePublicProject('ghost', mkFetch({ project: null })), null, 'unknown/private → null');
  eq(await resolvePublicProject('x', mkFetch({ error: 'nope' }, 502)), null, 'non-200 → null');
  eq(await resolvePublicProject('x', mkFetch('not-json-shaped')), null, 'garbage body → null');
  eq(await resolvePublicProject('x', async () => { throw new Error('offline'); }), null, 'network throw → null');
  eq(await resolvePublicProject('', mkFetch({ project: row })), null, 'empty slug → null without fetching');
  const before = calls.length;
  await resolvePublicProject('   ', mkFetch({ project: row }));
  eq(calls.length, before, 'blank slug never fetches');
}

/* ── 2. rowForGuest → configForProject integration ───────────────────────────── */
{
  const uuid = 'bbbbbbbb-1111-4111-8111-000000000002';
  const row = rowForGuest({ id: uuid, slug: 'nile-river', title: 'Nile River', episode: null, updated_at: '2026-07-20T00:00:00Z' });
  eq(row.id, uuid, 'cloud UUID is the id');
  eq(row.cloudId, uuid, 'cloudId mirrors it');
  const cfg = configForProject(row);
  eq(cfg.id, uuid, 'engine config id = cloud UUID');
  ok(cfg.storage.DOC.startsWith(`script_${uuid}_`), 'doc namespace derives from the UUID');
  ok(cfg.cloud.api.includes(`project=${encodeURIComponent(uuid)}`), 'doc GET targets /api/script-doc?project=<uuid>');
  eq(cfg.localOnly, false, 'cloud-backed (the read path pulls the live cloud doc)');

  const legacy = rowForGuest({ id: 'cccccccc-2222-4222-8222-000000000003', slug: 'burma', title: 'Burma', episode: 'burma', updated_at: null });
  const legacyCfg = configForProject(legacy);
  eq(legacyCfg.id, 'burma', 'legacy episode pin mounts the pinned BURMA config');

  eq(rowForGuest(null), null, 'null-safe');
  eq(rowForGuest({}), null, 'id-less wire row → null');
}

/* ── 3. forceReadOnly is a one-way latch, and boot latches before the engine ─── */
{
  __setReadOnlyForTest(false);
  eq(isReadOnly(), false, 'baseline: not read-only headless');
  eq(forceReadOnly(), true, 'forceReadOnly latches ON');
  eq(isReadOnly(), true, 'latched');
  forceReadOnly();
  eq(isReadOnly(), true, 'idempotent — still on');
  ok(!/forceReadOnly\s*\([^)]*false/.test(readFileSync(join(HERE, '../../burma-script/src/read-mode.js'), 'utf8')),
    'forceReadOnly takes no argument — there is no "force editable" spelling');
  __setReadOnlyForTest(false); // restore for any later import in this process
}

/* ── 4. boot.jsx guest-branch wiring (source scan) ───────────────────────────── */
{
  const guestFn = bootSrc.slice(bootSrc.indexOf('async function openProjectAsGuest'), bootSrc.indexOf('// Route-change dispatch'));
  ok(guestFn.length > 0, 'openProjectAsGuest exists in boot.jsx');

  const latchAt = guestFn.indexOf('forceReadOnly()');
  const engineAt = guestFn.indexOf("import('../../burma-script/src/main.jsx')");
  const episodeAt = guestFn.indexOf('setEpisode(');
  ok(latchAt > -1 && engineAt > -1, 'guest path latches read-only and imports the engine');
  ok(latchAt < episodeAt && episodeAt < engineAt, 'ORDER: forceReadOnly → setEpisode → engine import');

  ok(!guestFn.includes('touchProject'), 'guest path never touches the project (no updatedAt write)');
  ok(!guestFn.includes('startPresence') && !guestFn.includes("import('./presence.js')"), 'guest path never starts the presence heartbeat');
  ok(!guestFn.includes('injectMastheadRename'), 'guest path never wires rename');
  ok(!guestFn.includes('injectLibraryBackbar'), 'guest path never injects the < Library backbar');
  ok(guestFn.includes('injectGuestSignInPill'), 'guest path injects the Sign-in pill instead');
  ok(!guestFn.includes('mountLibrary'), 'guest path can never mount the library');
  ok(guestFn.includes('mountPrivateScriptPage'), 'unknown/private slug lands on the private page');
  ok(!guestFn.includes("window.location.hash = 'library'"), 'guest failure never bounces to #library');

  // The boot switch: guests on a library route still hit the sign-in wall.
  const bootTail = bootSrc.slice(bootSrc.indexOf('const session = await detectSession()'));
  ok(bootTail.includes("session === 'guest'"), 'boot branches on the detected session');
  ok(bootTail.includes('if (!isLibraryRoute(slug)) return openProjectAsGuest(slug)'),
    'guest + project slug → guest path');
  ok(bootTail.includes('await ensureUnlocked()'), 'guest + #library → ensureUnlocked (the wall, exactly as before)');

  // The route reconciler: a guest hash edit must NEVER run applyRouteFromUrl (its unknown-slug
  // fallback mounts the library). Guests reload on route change; boot re-runs and re-forks.
  const dispatch = bootSrc.slice(bootSrc.indexOf('function onRouteEvent'), bootSrc.indexOf('seedIfAbsent()'));
  ok(dispatch.includes('if (!guestSession) return applyRouteFromUrl()'), 'signed-in reconciler unchanged');
  ok(dispatch.includes('window.location.reload()'), 'guest route change → reload (re-forks through boot)');
  ok(!/guestSession[\s\S]*applyRouteFromUrl\(\)/.test(dispatch.slice(dispatch.indexOf('if (!guestSession)') + 40)),
    'no guest branch reaches applyRouteFromUrl');
  ok(bootSrc.includes("window.addEventListener('hashchange', onRouteEvent)") &&
     bootSrc.includes("window.addEventListener('popstate', onRouteEvent)"),
    'both route events go through the dispatch');
}

/* ── 5. guest.js has zero write verbs; gate.js seam intact ───────────────────── */
{
  ok(!/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(guestSrc), 'guest.js contains NO write-verb fetch');
  ok(!/localStorage\.(setItem|removeItem)/.test(guestSrc), 'guest.js writes no storage');
  ok((guestSrc.match(/fetchImpl\(/g) || []).length === 1, 'exactly one fetch site in guest.js (the scoped resolution)');

  ok(gateSrc.includes('export async function detectSession'), 'gate.js exports detectSession');
  ok(gateSrc.includes('export function requestSignIn'), 'gate.js exports requestSignIn (private page / pill affordance)');
  const ensure = gateSrc.slice(gateSrc.indexOf('export async function ensureUnlocked'));
  ok(ensure.includes('showGate()'), 'ensureUnlocked still shows the sign-in wall for guests');
}

console.log(`guest-gate-contract: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
