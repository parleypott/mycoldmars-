/**
 * Tests for worlds.js — QSS's CLIENT-SIDE world registry + routing shim
 * (window.QSSWorlds). This is load-bearing, previously ZERO-coverage infra:
 * it decides (a) which world is ACTIVE (URL > localStorage > default), (b) the
 * per-world localStorage namespace every page reads/writes through QSSWorlds.key(),
 * and (c) the fetch wrapper that injects the active world_slug into /api/qss-*
 * calls so the SERVER prepends the right world's canon to image-gen + story prompts.
 * A regression in any of these silently mixes one world's data/canon into another —
 * exactly the world-routing landmine class fixed five times SERVER-side this week
 * (qss-worlds/explorer/cast/stories/world-style). The client had no lock at all.
 *
 * worlds.js is a browser IIFE (no exports), so we load the REAL shipped file under
 * mocked globals (window/document/localStorage/location/MutationObserver) and drive
 * window.QSSWorlds + the installed fetch wrapper. No mirror, no extraction — the
 * test exercises the byte-for-byte served code, so it can't drift.
 *
 * Run: node queen-scarlet-school/lib/worlds.test.mjs   (or via `bun run test`)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORLDS_SRC = readFileSync(
  join(HERE, '..', '..', 'public', 'queen-scarlet-school', 'lib', 'worlds.js'),
  'utf8',
);

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${label}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, label) { eq(!!cond, true, label); }

// ── Minimal browser-global sandbox ──────────────────────────────────────────
// A universal, permissive DOM element stub: any method call is a harmless no-op,
// any property read returns another stub, any assignment is swallowed. Enough for
// worlds.js's boot side effects (injectCSS / paintTheme / installBurgundyMotto /
// ensureBurgundyMotion) to run without throwing. NONE of the DOM behavior is under
// test — only the pure routing / namespacing / fetch logic is — so a stub that
// absorbs every DOM op keeps the test focused and resilient to boot-path changes.
function makeEl() {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'firstChild' || prop === 'parentNode') return null;
      if (prop === 'dataset') return {};                 // real obj → .world is undefined, not 'burgundy'
      if (prop === 'style') return { setProperty() {}, removeProperty() {} };
      if (prop === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (prop === 'length') return 0;
      if (prop === 'textContent' || prop === 'innerHTML') return '';
      if (prop === Symbol.toPrimitive || prop === Symbol.iterator) return undefined;
      return makeEl();                                   // any method/child element → another stub
    },
    apply() { return makeEl(); },                        // calling a "method" returns a stub
    set() { return true; },                              // swallow innerHTML/textContent/etc. assignments
  });
}

function freshWorld(initialPath = '/queen-scarlet-school/') {
  // Map-backed localStorage with the real Web Storage surface worlds.js uses.
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  const location = { pathname: initialPath, href: initialPath };
  // origFetch captured by the wrapper; record every call so we can assert injection.
  const fetchCalls = [];
  const origFetch = (input, init) => {
    fetchCalls.push({ input, init });
    return Promise.resolve({ ok: true, status: 200, _mock: true });
  };
  const window = { fetch: origFetch };
  const document = {
    readyState: 'complete',
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
    createElement: () => makeEl(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  class MutationObserver { observe() {} disconnect() {} }
  const consoleMock = { log() {}, warn() {}, error() {} };

  // worlds.js is `(function(){ ... })();` — run it with browser globals bound as
  // params so the bare `window`/`document`/`localStorage`/`location` references
  // inside resolve to our mocks. encodeURIComponent/JSON/Object are Node globals.
  const run = new Function(
    'window', 'document', 'localStorage', 'location', 'console', 'MutationObserver',
    WORLDS_SRC,
  );
  run(window, document, localStorage, location, consoleMock, MutationObserver);

  return { QSS: window.QSSWorlds, window, localStorage, location, fetchCalls, store };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Boot — the public API surface installs cleanly
// ════════════════════════════════════════════════════════════════════════════
{
  const { QSS, window } = freshWorld();
  ok(QSS, 'BOOT: window.QSSWorlds is installed');
  for (const fn of ['getActive', 'setActive', 'key', 'get', 'list', 'activeWorld',
    'libraryHref', 'castHref', 'writeHref', 'storyHref', 'pageKind']) {
    eq(typeof QSS[fn], 'function', `BOOT: QSSWorlds.${fn} is a function`);
  }
  ok(window.__qssWorldFetchInstalled, 'BOOT: fetch wrapper installed');
  eq(QSS.list().length, 2, 'BOOT: registry has both worlds');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. getActive — URL-first resolution (deep links land in the right world)
// ════════════════════════════════════════════════════════════════════════════
{
  const { QSS } = freshWorld('/universe/burgundy/');
  eq(QSS.getActive(), 'burgundy', 'URL: /universe/burgundy/ → burgundy');
}
{
  const { QSS } = freshWorld('/universe/queen-scarlet/write/some-story');
  eq(QSS.getActive(), 'queen-scarlet', 'URL: deep write path → queen-scarlet');
}
{
  const { QSS } = freshWorld('/universe/BURGUNDY/cast/');
  eq(QSS.getActive(), 'burgundy', 'URL: uppercase slug lowercased → burgundy');
}
{
  // Unknown slug in URL → not a real world → fall through to LS/default.
  const { QSS } = freshWorld('/universe/emerald/');
  eq(QSS.getActive(), 'queen-scarlet', 'URL: unknown world → default, NOT emerald');
}
{
  // Bare /universe/ planet picker carries no slug → default.
  const { QSS } = freshWorld('/universe/');
  eq(QSS.getActive(), 'queen-scarlet', 'URL: bare /universe/ → default');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. getActive — localStorage fallback when URL has no world, URL beats LS
// ════════════════════════════════════════════════════════════════════════════
{
  const { QSS, localStorage } = freshWorld('/queen-scarlet-school/');
  localStorage.setItem('qss:world:active', 'burgundy');
  eq(QSS.getActive(), 'burgundy', 'LS: legacy path + LS=burgundy → burgundy');
}
{
  const { QSS, localStorage } = freshWorld('/queen-scarlet-school/');
  localStorage.setItem('qss:world:active', 'emerald'); // invalid
  eq(QSS.getActive(), 'queen-scarlet', 'LS: invalid LS value → default');
}
{
  const { QSS } = freshWorld('/queen-scarlet-school/');
  eq(QSS.getActive(), 'queen-scarlet', 'LS: unset → default');
}
{
  // URL must WIN over a conflicting localStorage value.
  const { QSS, localStorage } = freshWorld('/universe/queen-scarlet/');
  localStorage.setItem('qss:world:active', 'burgundy');
  eq(QSS.getActive(), 'queen-scarlet', 'URL>LS: URL queen-scarlet beats LS burgundy');
}
{
  // getActive mirrors the URL world back into LS for code that reads LS directly.
  const { QSS, localStorage } = freshWorld('/universe/burgundy/');
  QSS.getActive();
  eq(localStorage.getItem('qss:world:active'), 'burgundy', 'MIRROR: URL world mirrored to LS');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. key() — per-world localStorage namespacing (the data-isolation contract)
// ════════════════════════════════════════════════════════════════════════════
{
  const { QSS } = freshWorld('/universe/queen-scarlet/');
  eq(QSS.key('globalcast'), 'qss:world:queen-scarlet:globalcast', 'KEY: qsc globalcast');
  eq(QSS.key('story:my-id'), 'qss:world:queen-scarlet:story:my-id', 'KEY: qsc story id');
}
{
  const { QSS } = freshWorld('/universe/burgundy/');
  eq(QSS.key('globalcast'), 'qss:world:burgundy:globalcast', 'KEY: burgundy namespaced separately');
}
{
  // Same suffix → DIFFERENT key per world (no cross-world bleed).
  const a = freshWorld('/universe/queen-scarlet/').QSS.key('cast');
  const b = freshWorld('/universe/burgundy/').QSS.key('cast');
  ok(a !== b, 'KEY: same suffix yields distinct keys across worlds');
}

// ════════════════════════════════════════════════════════════════════════════
// 5. get / list / activeWorld
// ════════════════════════════════════════════════════════════════════════════
{
  const { QSS } = freshWorld('/universe/burgundy/');
  eq(QSS.get('queen-scarlet').slug, 'queen-scarlet', 'GET: explicit slug');
  eq(QSS.get('emerald'), null, 'GET: unknown slug → null');
  eq(QSS.get().slug, 'burgundy', 'GET: no-arg → active world');
  eq(QSS.activeWorld().slug, 'burgundy', 'ACTIVE: activeWorld → burgundy');
  eq(QSS.list().map((w) => w.slug).sort(), ['burgundy', 'queen-scarlet'], 'LIST: both slugs');
}

// ════════════════════════════════════════════════════════════════════════════
// 6. href builders + pageKind (canonical /universe/<world>/ links)
// ════════════════════════════════════════════════════════════════════════════
{
  const { QSS } = freshWorld('/universe/queen-scarlet/');
  eq(QSS.libraryHref('burgundy'), '/universe/burgundy/', 'HREF: library explicit slug');
  eq(QSS.castHref('burgundy'), '/universe/burgundy/cast/', 'HREF: cast explicit slug');
  eq(QSS.writeHref('burgundy'), '/universe/burgundy/write/', 'HREF: write explicit slug');
  eq(QSS.libraryHref(), '/universe/queen-scarlet/', 'HREF: no-arg uses active world');
  eq(QSS.storyHref('burgundy', 'a b/c'), '/universe/burgundy/write/a%20b%2Fc', 'HREF: storyHref encodes id');
}
{
  eq(freshWorld('/universe/').QSS.pageKind(), 'universe', 'KIND: /universe/ → universe');
  eq(freshWorld('/universe/burgundy/cast/').QSS.pageKind(), 'cast', 'KIND: cast');
  eq(freshWorld('/universe/burgundy/write/x').QSS.pageKind(), 'workshop', 'KIND: write → workshop');
  eq(freshWorld('/universe/burgundy/').QSS.pageKind(), 'library', 'KIND: world root → library');
}

// ════════════════════════════════════════════════════════════════════════════
// 7. fetch wrapper — inject the active world into /api/qss-* calls
//    (wrong world here = wrong canon in Henry's image-gen + story prompts)
// ════════════════════════════════════════════════════════════════════════════
async function lastCall(fetchCalls) { return fetchCalls[fetchCalls.length - 1]; }

// 7a. POST with no world → body.world injected with the ACTIVE world
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/qss-cast', { method: 'POST', body: JSON.stringify({ name: 'x' }) });
  const sent = JSON.parse((await lastCall(fetchCalls)).init.body);
  eq(sent.world, 'burgundy', 'POST: body.world injected with active world');
  eq(sent.name, 'x', 'POST: original body fields preserved');
}
// 7b. POST that already carries `world` → NOT overridden
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/qss-cast', { method: 'POST', body: JSON.stringify({ world: 'queen-scarlet' }) });
  const sent = JSON.parse((await lastCall(fetchCalls)).init.body);
  eq(sent.world, 'queen-scarlet', 'POST: existing world NOT overridden');
}
// 7c. POST that carries `world_slug` → NOT overridden, no stray `world` added
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/qss-cast', { method: 'POST', body: JSON.stringify({ world_slug: 'queen-scarlet' }) });
  const sent = JSON.parse((await lastCall(fetchCalls)).init.body);
  eq(sent.world_slug, 'queen-scarlet', 'POST: existing world_slug honored');
  ok(!('world' in sent), 'POST: no stray world added when world_slug present');
}
// 7d. GET → ?world=<active> appended
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/qss-cast');
  eq((await lastCall(fetchCalls)).input, '/api/qss-cast?world=burgundy', 'GET: ?world appended');
}
// 7e. GET with an existing query → &world=<active> appended
{
  const { window, fetchCalls } = freshWorld('/universe/queen-scarlet/');
  await window.fetch('/api/qss-cast?story=1');
  eq((await lastCall(fetchCalls)).input, '/api/qss-cast?story=1&world=queen-scarlet', 'GET: &world appended after existing query');
}
// 7f. GET already carrying world → NOT doubled
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/qss-cast?world=queen-scarlet');
  eq((await lastCall(fetchCalls)).input, '/api/qss-cast?world=queen-scarlet', 'GET: existing world param not doubled');
}
// 7g. GET already carrying world_slug → NOT given a second world param
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/qss-cast?world_slug=queen-scarlet');
  eq((await lastCall(fetchCalls)).input, '/api/qss-cast?world_slug=queen-scarlet', 'GET: existing world_slug not augmented');
}
// 7h. non-qss API → completely untouched (no world injected, body verbatim)
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/whh-score', { method: 'POST', body: JSON.stringify({ a: 1 }) });
  const c = await lastCall(fetchCalls);
  eq(c.input, '/api/whh-score', 'NONQSS: url untouched');
  eq(JSON.parse(c.init.body), { a: 1 }, 'NONQSS: body untouched (no world)');
}
// 7i. non-qss GET → no ?world appended
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/whh-daily-watch');
  eq((await lastCall(fetchCalls)).input, '/api/whh-daily-watch', 'NONQSS GET: no world param');
}
// 7j. a param merely PREFIXED with "world" (worldview=) must not block injection
{
  const { window, fetchCalls } = freshWorld('/universe/burgundy/');
  await window.fetch('/api/qss-cast?worldview=wide');
  eq((await lastCall(fetchCalls)).input, '/api/qss-cast?worldview=wide&world=burgundy', 'GET: worldview= is not world=, so world still injected');
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\nworlds: ${pass} passed, ${fail} failed (${pass + fail} total)`);
if (fails.length) { console.log('\n' + fails.join('\n')); process.exit(1); }
