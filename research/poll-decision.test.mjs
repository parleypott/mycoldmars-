// Locks decidePollOutcome — the deep-research poll-loop decision (see
// research/app.js). The fix: `incomplete` is now terminal (render the salvaged
// partial report, or fail fast) instead of falling through to "keep polling",
// which made an incomplete job hang until the 30-minute deadline.
import { decidePollOutcome } from './poll-decision.js';

let pass = 0, fail = 0;
const eq = (a, b, m) => { if (a === b) pass++; else { fail++; console.error(`FAIL: ${m}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`); } };
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`FAIL: ${m}`); } };

// --- INLINE RED PROOF: the OLD loop treated only completed=done, failed/cancelled=error;
//     everything else (incl. incomplete) -> keep polling (the hang). ---
function oldDecide(data) {
  if (data.status === 'completed') return { action: 'done', report: data.report ?? '(empty result)' };
  if (data.status === 'failed' || data.status === 'cancelled') return { action: 'error', error: `openai ${data.status}: ${data.error ?? ''}` };
  return { action: 'wait' };
}
{
  const oldO = oldDecide({ status: 'incomplete', report: 'partial', incomplete_reason: 'max_output_tokens' });
  eq(oldO.action, 'wait', 'RED PROOF: old loop keeps polling an incomplete job (the hang)');
  const newO = decidePollOutcome({ status: 'incomplete', report: 'partial', incomplete_reason: 'max_output_tokens' });
  eq(newO.action, 'done', 'RED PROOF: new loop terminates an incomplete job with a partial report');
}

// --- completed ---
{
  const o = decidePollOutcome({ status: 'completed', report: 'Full report.' });
  eq(o.action, 'done', 'completed -> done');
  eq(o.report, 'Full report.', 'completed report passed through');
}
{
  const o = decidePollOutcome({ status: 'completed' });
  eq(o.report, '(empty result)', 'completed with no report -> placeholder');
}

// --- incomplete WITH a partial report -> done + truncation note ---
{
  const o = decidePollOutcome({ status: 'incomplete', report: 'Partial body.', incomplete_reason: 'max_output_tokens' });
  eq(o.action, 'done', 'incomplete+report -> done (no hang)');
  ok(o.report.startsWith('Partial body.'), 'incomplete keeps the partial body');
  ok(o.report.includes('max_output_tokens'), 'incomplete note carries the reason');
  ok(o.report.includes('partial report'), 'incomplete note flags it as partial');
}
{
  const o = decidePollOutcome({ status: 'incomplete', report: 'Body only.' });
  eq(o.action, 'done', 'incomplete+report, no reason -> still done');
  ok(o.report.includes('partial report'), 'incomplete no-reason note still flags partial');
}

// --- incomplete with NO usable report -> error (fail fast, not hang) ---
{
  const o = decidePollOutcome({ status: 'incomplete', incomplete_reason: 'content_filter' });
  eq(o.action, 'error', 'incomplete with no report -> error (fail fast)');
  ok(o.error.includes('content_filter'), 'incomplete error carries the reason');
}
{
  const o = decidePollOutcome({ status: 'incomplete', report: '   ' });
  eq(o.action, 'error', 'incomplete with whitespace-only report -> error');
  ok(o.error.includes('no output'), 'incomplete no-output error message');
}

// --- failed / cancelled -> error, message format preserved ---
{
  const o = decidePollOutcome({ status: 'failed', error: 'kaboom' });
  eq(o.action, 'error', 'failed -> error');
  eq(o.error, 'openai failed: kaboom', 'failed message format preserved');
}
{
  const o = decidePollOutcome({ status: 'cancelled' });
  eq(o.action, 'error', 'cancelled -> error');
  eq(o.error, 'openai cancelled: ', 'cancelled message format (no error field)');
}

// --- non-terminal statuses -> wait (keep polling) ---
for (const s of ['queued', 'in_progress', undefined, 'weird']) {
  eq(decidePollOutcome({ status: s }).action, 'wait', `${s} -> wait`);
}
eq(decidePollOutcome(null).action, 'wait', 'null data -> wait (no throw)');

// --- no-regression: completed/failed/cancelled/wait identical to OLD decision ---
for (const fx of [
  { status: 'completed', report: 'R' },
  { status: 'completed' },
  { status: 'failed', error: 'e' },
  { status: 'cancelled' },
  { status: 'in_progress' },
  { status: 'queued' },
]) {
  eq(JSON.stringify(decidePollOutcome(fx)), JSON.stringify(oldDecide(fx)),
     `no-regression: ${fx.status} decision identical to old`);
}

console.log(`poll-decision: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
