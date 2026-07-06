// nile-flights booking tracker — crash-safe boot-time localStorage lock.
//
// THE BUG (fixed): the booker-name read ran RAW at boot —
//   whoInput.value = localStorage.getItem("nile-booker") || "Marisa";
// Merely ACCESSING window.localStorage throws a SecurityError in restricted contexts:
// storage blocked, some in-app webviews (the Gmail/Slack in-app browser Marisa may tap
// the link from), Safari "Block All Cookies". That read (and the change-handler write)
// execute at BOOT, BEFORE render()/load() run, so an unguarded throw aborts the entire
// script — the timeline never renders and the page hangs permanently on "syncing…".
// This is a live, shared page Johnny + Marisa open from links on the road, so a
// storage-restricted webview is a real, reachable brick — the exact crash-safe-storage
// class the repo already closed on the theme toggles (palau / mme / borders / pinglobe).
//
// The fix wraps both the read and the write in try/catch (lsGet / lsSet). lsGet is
// byte-identical to the old `getItem(k) || d` on the happy path; on a throw it degrades
// to the default so the rest of the script keeps running and the timeline renders.
// This test pins the guard against the SHIPPED index.html so the raw sink can't return.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  try { assert.ok(cond, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};

// ---- RED proof: no raw, unguarded boot-time localStorage access remains ----
ok(!/whoInput\.value\s*=\s*localStorage\.getItem/.test(html),
   'no raw `whoInput.value = localStorage.getItem(...)` boot read remains');
ok(!/change["']?,\s*\(\)\s*=>\s*localStorage\.setItem/.test(html),
   'no raw `localStorage.setItem` in the change handler remains');

// ---- GREEN: crash-safe helpers are defined and used ----
ok(/const lsGet\s*=/.test(html), 'a crash-safe lsGet helper is defined');
ok(/const lsSet\s*=/.test(html), 'a crash-safe lsSet helper is defined');
ok(/whoInput\.value\s*=\s*lsGet\(/.test(html), 'the boot read rides through lsGet(...)');
ok(/=>\s*lsSet\(/.test(html), 'the change handler rides through lsSet(...)');

// Each helper wraps its localStorage access in try/catch.
ok(/const lsGet\s*=\s*\([^)]*\)\s*=>\s*\{\s*try\s*\{[\s\S]*?catch/.test(html),
   'lsGet wraps its localStorage access in try/catch');
ok(/const lsSet\s*=\s*\([^)]*\)\s*=>\s*\{\s*try\s*\{[\s\S]*?catch/.test(html),
   'lsSet wraps its localStorage access in try/catch');

// ---- behaviour: extract the SHIPPED helpers and prove they survive a throwing store ----
{
  const gm = html.match(/const lsGet\s*=\s*(\([^)]*\)\s*=>\s*\{[\s\S]*?\});/);
  const sm = html.match(/const lsSet\s*=\s*(\([^)]*\)\s*=>\s*\{[\s\S]*?\});/);
  ok(!!gm, 'lsGet body is extractable from the source');
  ok(!!sm, 'lsSet body is extractable from the source');

  if (gm && sm) {
    // eslint-disable-next-line no-eval
    const makeEnv = (localStorage) => {
      // eslint-disable-next-line no-eval
      const lsGet = eval('(' + gm[1].replace(/localStorage/g, 'localStorage') + ')');
      const lsSet = eval('(' + sm[1] + ')');
      return { lsGet, lsSet };
    };

    // 1) A THROWING store (SecurityError on access) must NOT propagate.
    const throwing = {
      getItem() { throw new Error('SecurityError: The operation is insecure.'); },
      setItem() { throw new Error('SecurityError: The operation is insecure.'); },
    };
    globalThis.localStorage = throwing;
    let env = makeEnv(throwing);
    let bricked = false;
    let val;
    try { val = env.lsGet('nile-booker', 'Marisa'); } catch (e) { bricked = true; }
    ok(!bricked, 'lsGet does NOT throw when localStorage access throws (page keeps booting)');
    ok(val === 'Marisa', 'lsGet returns the default when the store throws');
    bricked = false;
    try { env.lsSet('nile-booker', 'Johnny'); } catch (e) { bricked = true; }
    ok(!bricked, 'lsSet does NOT throw when localStorage access throws');

    // 2) A WORKING store must behave byte-identically to the old `getItem(k) || d`.
    const store = new Map();
    const working = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
    };
    globalThis.localStorage = working;
    env = makeEnv(working);
    ok(env.lsGet('nile-booker', 'Marisa') === 'Marisa',
       'lsGet returns the default when the key is absent (matches old `|| "Marisa"`)');
    env.lsSet('nile-booker', 'Johnny');
    ok(store.get('nile-booker') === 'Johnny', 'lsSet persists to a working store');
    ok(env.lsGet('nile-booker', 'Marisa') === 'Johnny', 'lsGet reads back the persisted value');
    // Empty-string stored value falls back to the default, exactly like the old `|| d`.
    store.set('nile-booker', '');
    ok(env.lsGet('nile-booker', 'Marisa') === 'Marisa',
       'lsGet falls back on an empty stored value (byte-identical to the old `|| d`)');

    delete globalThis.localStorage;
  }
}

if (fail) { console.error(`ls-boot-guard: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`ls-boot-guard: ${pass} passed, 0 failed`);
