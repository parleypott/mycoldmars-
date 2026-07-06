/**
 * tokenExpiresWithin — the guard that fixes "SAVED ON THIS DEVICE · CLOUD OFFLINE".
 * A stale Supabase JWT injected on an /api write 401'd silently and dropped the pill to offline.
 * Now the interceptor refreshes when this returns true. Pure JWT-exp decode; test with hand-built tokens.
 *
 * Run: bun scripts-library/src/token-expiry.test.mjs
 */
import { tokenExpiresWithin } from './auth-token.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };

// Minimal JWT with a given exp (seconds). Header/sig are dummies; only the payload matters here.
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const jwt = (exp) => `eyJhbGciOiJIUzI1NiJ9.${b64url({ sub: 'u', exp })}.sig`;
const now = () => Math.floor(Date.now() / 1000);

ok(tokenExpiresWithin(jwt(now() - 60)) === true, 't1. already-expired token → expiring (refresh)');
ok(tokenExpiresWithin(jwt(now() + 10)) === true, 't2. expires in 10s (< 60s skew) → expiring');
ok(tokenExpiresWithin(jwt(now() + 3600)) === false, 't3. fresh 1h token → NOT expiring');
ok(tokenExpiresWithin(jwt(now() + 3600), 60) === false, 't4. 1h token with 60s skew → fine');
ok(tokenExpiresWithin(jwt(now() + 30), 60) === true, 't5. 30s left, 60s skew → expiring');
ok(tokenExpiresWithin(null) === true, 't6. null → treat as expiring (fail safe)');
ok(tokenExpiresWithin('') === true, 't7. empty → expiring');
ok(tokenExpiresWithin('not-a-jwt') === true, 't8. garbage → expiring (never inject unverifiable)');
ok(tokenExpiresWithin('a.b') === true, 't9. missing signature part still decodes payload b; malformed → expiring');
ok(tokenExpiresWithin(`eyJhbGciOiJIUzI1NiJ9.${b64url({ sub: 'u' })}.sig`) === true, 't10. no exp claim → expiring (unknown = refresh)');

console.log(`\ntoken-expiry: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
