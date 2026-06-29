// Locks the Hunter gate's getCookie() safe-decode behavior (hunter/index.html).
//
// The gate runs as an inline IIFE — it can't be imported — so this is a byte-faithful
// copy of its getCookie cookie-value decode, with a mutation-lock proving the try/catch
// is load-bearing.
//
// The live bug it guards: np_hunter_access is normally set via encodeURIComponent
// ('granted'), but a corrupt/foreign cookie value carrying a bare "%" makes
// decodeURIComponent throw URIError. Unguarded, that crashes the whole gate IIFE and
// white-screens the Hunter page (no gate, no app). The guard degrades to the raw value
// so the page still renders (and falls through to the gate for a non-'granted' value).

import { strict as assert } from 'node:assert';

// --- byte-faithful copy of hunter/index.html getCookie() decode core ---
function getCookieFrom(cookieString, name) {
  const match = cookieString.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };

const NAME = 'np_hunter_access';

// Happy path — granted value round-trips identically (byte-for-byte, no regression).
ok(getCookieFrom(`${NAME}=granted`, NAME) === 'granted', 'granted decodes to granted');
ok(getCookieFrom(`foo=bar; ${NAME}=granted; baz=qux`, NAME) === 'granted', 'granted found among other cookies');

// Absent cookie — null (shows the gate).
ok(getCookieFrom('other=1', NAME) === null, 'absent cookie -> null');
ok(getCookieFrom('', NAME) === null, 'empty cookie string -> null');

// Encoded value decodes (the normal setCookie path uses encodeURIComponent).
ok(getCookieFrom(`${NAME}=a%20b`, NAME) === 'a b', 'percent-encoded space decodes');

// LOAD-BEARING: a bare "%" is malformed percent-encoding -> decodeURIComponent throws.
// The guard must NOT throw, and must degrade to the raw value (which is !== 'granted',
// so the gate is shown rather than the page crashing). Removing the try/catch makes
// this line throw URIError -> RED.
let threw = false, rawVal = null;
try { rawVal = getCookieFrom(`${NAME}=100%`, NAME); } catch { threw = true; }
ok(!threw, 'malformed-% value does NOT throw (no white-screen)');
ok(rawVal === '100%', 'malformed-% value degrades to the raw string');
ok(rawVal !== 'granted', 'malformed value never admits as granted');

// Sanity: prove the underlying hazard is real — bare decode DOES throw on this input,
// so the guard above is genuinely doing work.
let bareThrew = false;
try { decodeURIComponent('100%'); } catch { bareThrew = true; }
ok(bareThrew, 'decodeURIComponent("100%") throws URIError (hazard is real)');

console.log(`gate-cookie-decode: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
