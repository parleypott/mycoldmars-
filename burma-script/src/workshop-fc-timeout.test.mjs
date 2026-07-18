/*
 * workshop-fc-timeout.test.mjs — the "CHECKING… forever" client-side guarantee (browser-free,
 * string-parsing Workshop.jsx, same style as chrome-legibility.test.mjs).
 *
 * Measured in prod (2026-07-06): a VERIFY CLAIM request rode to Vercel's 120s
 * FUNCTION_INVOCATION_TIMEOUT and the browser fetch had NO timeout at all — on a stalled
 * connection the spinner could sit for minutes ("forever"). The contract locked here:
 *
 *   1. the client fetch carries an AbortController with a hard timeout,
 *   2. that timeout is LONGER than the server's own deadline (server JSON error should win
 *      in normal operation) but bounded ≤ 2 minutes,
 *   3. the AbortError path produces a human message (not a stack trace),
 *   4. loading/ticker/killer are all torn down in finally — the spinner can never stick,
 *   5. the button label ticks elapsed seconds so the wait feels determinate.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(here, 'Workshop.jsx'), 'utf8');
const api = readFileSync(join(here, '..', '..', 'api', 'burma-tk.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.error('  ✗', name, extra != null ? '— ' + extra : ''); } }

// 1. hard client timeout exists and the fetch is actually wired to it
const mClient = jsx.match(/FC_CLIENT_TIMEOUT_MS\s*=\s*([\d_]+)/);
ok('client timeout constant defined', !!mClient);
const clientMs = mClient ? Number(mClient[1].replace(/_/g, '')) : NaN;
ok('client timeout ≤ 120s (never "forever")', clientMs <= 120_000, String(clientMs));
ok('AbortController armed', /new AbortController\(\)/.test(jsx));
// 2026-07-17: two bounds now — interactive (FC_CLIENT_TIMEOUT_MS) and DEEP CHECK
// (DEEP_CLIENT_TIMEOUT_MS). The abort must be scheduled at the per-run selection, and the
// selection must be exactly a ternary over the two named constants — no third path, no
// unbounded branch. The original guarantee (every fc fetch aborts at a hard bound) holds.
ok('abort scheduled at the per-run client bound', /setTimeout\(\(\)\s*=>\s*ac\.abort\(\),\s*clientTimeout\)/.test(jsx));
ok('per-run bound selects ONLY between the two named constants',
  /clientTimeout\s*=\s*isDeepRun\s*\?\s*DEEP_CLIENT_TIMEOUT_MS\s*:\s*FC_CLIENT_TIMEOUT_MS/.test(jsx));
const mDeepClient = jsx.match(/DEEP_CLIENT_TIMEOUT_MS\s*=\s*([\d_]+)/);
ok('deep client timeout constant defined', !!mDeepClient);
const deepClientMs = mDeepClient ? Number(mDeepClient[1].replace(/_/g, '')) : NaN;
ok('deep client timeout ≤ 5min (deep, not forever)', deepClientMs <= 300_000, String(deepClientMs));
ok('fetch carries the signal', /signal:\s*ac\.signal/.test(jsx));

// 2. cross-file contract: client bound > server bound (server's clean JSON 504 wins normally)
const mServer = api.match(/FC_UPSTREAM_TIMEOUT_MS\s*=\s*([\d_]+)/);
ok('server timeout constant found in api/burma-tk.js', !!mServer);
const serverMs = mServer ? Number(mServer[1].replace(/_/g, '')) : NaN;
ok('client timeout > server timeout + 10s slop', clientMs >= serverMs + 10_000, `client ${clientMs} vs server ${serverMs}`);
// Same cross-file contract on the deep lane: the server's clean JSON 504 (240s) must win
// before the client's own abort (260s) in normal operation.
const mDeepServer = api.match(/FC_DEEP_TIMEOUT_MS\s*=\s*([\d_]+)/);
ok('deep server timeout constant found in api/burma-tk.js', !!mDeepServer);
const deepServerMs = mDeepServer ? Number(mDeepServer[1].replace(/_/g, '')) : NaN;
ok('deep client timeout > deep server timeout + 10s slop', deepClientMs >= deepServerMs + 10_000, `client ${deepClientMs} vs server ${deepServerMs}`);

// 3. AbortError becomes a human message
ok('AbortError branch produces a plain-language timeout message',
  /AbortError'?\s*[\s\S]{0,120}timed out/i.test(jsx));

// 4. teardown in finally — the spinner can never stick
const finallyBlock = (jsx.split(/\bfinally\s*{/)[1] || '').slice(0, 300);
ok('finally clears the abort killer', /clearTimeout\(killer\)/.test(finallyBlock));
ok('finally clears the elapsed ticker', /clearInterval\(ticker\)/.test(finallyBlock));
ok('finally clears loading', /setLoading\(false\)/.test(finallyBlock));

// 5. determinate feel: elapsed seconds tick in the button label while loading
ok('elapsed state exists', /\[elapsed,\s*setElapsed\]/.test(jsx));
ok('ticker updates elapsed every second', /setInterval\([\s\S]{0,120}setElapsed/.test(jsx));
ok('button label renders the elapsed seconds', /elapsed\s*>\s*0\s*\?\s*`?\s*\$\{elapsed\}s/.test(jsx) || /\$\{elapsed\}s/.test(jsx));

console.log(`workshop-fc-timeout: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
