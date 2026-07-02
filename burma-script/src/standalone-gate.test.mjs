/*
 * standalone-gate.test.mjs — Enterprise Wave 1, feature #4.
 *
 * The standalone /burma-script/ and /palau-script/ doors mount the full editor + live cloud sync with
 * NO login. This gate redirects the EDITABLE door into the login-gated library, while leaving ?read /
 * ?view read-only shares (write-incapable) working without a login. Locks both halves.
 */
import { libraryRedirectTarget, redirectStandaloneToLibrary } from './standalone-gate.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

// ── decide-only core ──────────────────────────────────────────────────────────────────────────────
ok(libraryRedirectTarget({ readOnly: false, slug: 'burma', pathname: '/burma-script/' }) === '/scripts-library/#burma', 'editable burma → library route');
ok(libraryRedirectTarget({ readOnly: false, slug: 'palau', pathname: '/palau-script/' }) === '/scripts-library/#palau', 'editable palau → library route');
ok(libraryRedirectTarget({ readOnly: true, slug: 'burma', pathname: '/burma-script/' }) === null, 'read-only share → NO redirect');
ok(libraryRedirectTarget({ readOnly: false, slug: '', pathname: '/x/' }) === null, 'no slug → no redirect');
ok(libraryRedirectTarget({ readOnly: false, slug: 'burma', pathname: '/scripts-library/' }) === null, 'already in library → no loop');

// ── redirect performer with an injected location ──────────────────────────────────────────────────
function fakeLoc(pathname) {
  const calls = [];
  return { loc: { pathname, replace: (t) => calls.push(['replace', t]), href: '' }, calls };
}

{ // editable door redirects and reports true
  const { loc, calls } = fakeLoc('/burma-script/');
  const did = redirectStandaloneToLibrary('burma', { location: loc, readOnly: false });
  ok(did === true, 'editable: returns true (caller skips booting engine)');
  ok(calls.length === 1 && calls[0][1] === '/scripts-library/#burma', 'editable: location.replace to library route');
}

{ // read-only share does NOT redirect and reports false (standalone read-only view boots normally)
  const { loc, calls } = fakeLoc('/burma-script/');
  const did = redirectStandaloneToLibrary('burma', { location: loc, readOnly: true });
  ok(did === false, 'read-only: returns false (boot standalone read-only)');
  ok(calls.length === 0, 'read-only: no navigation');
}

{ // fail-open on a broken location — never brick the door
  const did = redirectStandaloneToLibrary('burma', { location: null, readOnly: false });
  ok(did === false, 'no location → fail open (boot normally, do not brick)');
}

console.log(`standalone-gate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
