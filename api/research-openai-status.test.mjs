// Locks buildStatusPayload — the OpenAI deep-research poll-status extractor.
// The fix: an `incomplete` Responses object (long run hit max_output_tokens —
// a real terminal state carrying partial output) now yields the salvaged
// partial report + the reason, instead of being dropped. completed/failed/
// cancelled/in_progress behavior is byte-identical.
import { buildStatusPayload } from './research-openai-status.js';

let pass = 0, fail = 0;
const eq = (a, b, m) => { if (a === b) pass++; else { fail++; console.error(`FAIL: ${m}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`); } };
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`FAIL: ${m}`); } };

// --- fixtures ---
const completed = (extra = {}) => ({
  id: 'resp_1',
  status: 'completed',
  output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [
      { type: 'output_text', text: 'First para.', annotations: [
        { type: 'url_citation', url: 'https://a.example' },
        { type: 'url_citation', url: 'https://b.example' },
      ] },
      { type: 'output_text', text: 'Second para.', annotations: [
        { type: 'url_citation', url: 'https://a.example' }, // dup
      ] },
    ] },
  ],
  ...extra,
});

const incomplete = (extra = {}) => ({
  id: 'resp_2',
  status: 'incomplete',
  incomplete_details: { reason: 'max_output_tokens' },
  output: [
    { type: 'message', content: [
      { type: 'output_text', text: 'Partial findings so far.', annotations: [
        { type: 'url_citation', url: 'https://c.example' },
      ] },
    ] },
  ],
  ...extra,
});

// --- INLINE RED PROOF: the OLD logic only extracted on `completed`. ---
function oldBuildStatusPayload(data) {
  const payload = { id: data.id, status: data.status };
  if (data.status === 'completed') {
    let text = '';
    const sources = [];
    for (const item of data.output ?? []) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string') text += c.text + '\n';
          if (c.type === 'text' && typeof c.text === 'string') text += c.text + '\n';
          if (Array.isArray(c.annotations)) for (const a of c.annotations) if (a.type === 'url_citation' && a.url) sources.push(a.url);
        }
      }
    }
    payload.report = text.trim() + (sources.length ? `\n\n## Sources\n${[...new Set(sources)].map((u, i) => `${i + 1}. ${u}`).join('\n')}` : '');
  } else if (data.status === 'failed' || data.status === 'cancelled') {
    payload.error = JSON.stringify(data.error ?? {}).slice(0, 300);
  }
  return payload;
}
{
  const oldP = oldBuildStatusPayload(incomplete());
  ok(oldP.report === undefined, 'RED PROOF: old logic drops the partial report on incomplete (the bug)');
  const newP = buildStatusPayload(incomplete());
  ok(typeof newP.report === 'string' && newP.report.includes('Partial findings so far.'),
     'RED PROOF: new logic salvages the partial report on incomplete');
}

// --- completed: report built, sources deduped + numbered ---
{
  const p = buildStatusPayload(completed());
  eq(p.id, 'resp_1', 'completed id');
  eq(p.status, 'completed', 'completed status');
  ok(p.report.startsWith('First para.\nSecond para.'), 'completed text accumulated in order');
  ok(p.report.includes('## Sources'), 'completed sources section present');
  ok(p.report.includes('1. https://a.example'), 'completed first source numbered');
  ok(p.report.includes('2. https://b.example'), 'completed second source numbered');
  ok(!p.report.includes('3. https://a.example'), 'completed duplicate source deduped');
  ok(p.incomplete_reason === undefined, 'completed has no incomplete_reason');
  ok(p.error === undefined, 'completed has no error');
}

// --- completed with no sources: no Sources section ---
{
  const p = buildStatusPayload({ id: 'x', status: 'completed', output: [
    { type: 'message', content: [{ type: 'output_text', text: 'Just text.' }] },
  ] });
  eq(p.report, 'Just text.', 'completed no-sources report is just trimmed text');
}

// --- completed with empty output ---
{
  const p = buildStatusPayload({ id: 'x', status: 'completed', output: [] });
  eq(p.report, '', 'completed empty output -> empty report');
}

// --- completed, `text`-type content (fallback) also accumulates ---
{
  const p = buildStatusPayload({ id: 'x', status: 'completed', output: [
    { type: 'message', content: [{ type: 'text', text: 'Alt text.' }] },
  ] });
  eq(p.report, 'Alt text.', 'completed text-type content accumulated');
}

// --- incomplete WITH output: report salvaged + reason surfaced ---
{
  const p = buildStatusPayload(incomplete());
  eq(p.id, 'resp_2', 'incomplete id');
  eq(p.status, 'incomplete', 'incomplete status preserved (not lied to completed)');
  ok(p.report.includes('Partial findings so far.'), 'incomplete partial report extracted');
  ok(p.report.includes('1. https://c.example'), 'incomplete sources extracted');
  eq(p.incomplete_reason, 'max_output_tokens', 'incomplete reason from incomplete_details');
}

// --- incomplete with NO incomplete_details: reason defaults ---
{
  const p = buildStatusPayload({ id: 'x', status: 'incomplete', output: [
    { type: 'message', content: [{ type: 'output_text', text: 'Bit of text.' }] },
  ] });
  eq(p.incomplete_reason, 'incomplete', 'incomplete reason defaults when no details');
  ok(p.report.includes('Bit of text.'), 'incomplete report still extracted without details');
}

// --- incomplete with empty output: empty report + reason (frontend turns this into an error) ---
{
  const p = buildStatusPayload({ id: 'x', status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] });
  eq(p.report, '', 'incomplete empty output -> empty report');
  eq(p.incomplete_reason, 'content_filter', 'incomplete empty still carries reason');
}

// --- failed: error from data.error, no report ---
{
  const p = buildStatusPayload({ id: 'x', status: 'failed', error: { message: 'boom' } });
  eq(p.status, 'failed', 'failed status');
  ok(p.report === undefined, 'failed has no report');
  ok(p.error.includes('boom'), 'failed error serialized');
}

// --- cancelled ---
{
  const p = buildStatusPayload({ id: 'x', status: 'cancelled' });
  eq(p.status, 'cancelled', 'cancelled status');
  eq(p.error, '{}', 'cancelled error defaults to {}');
}

// --- in_progress / queued: pass-through, no report/error (frontend keeps polling) ---
for (const s of ['in_progress', 'queued']) {
  const p = buildStatusPayload({ id: 'x', status: s });
  eq(p.status, s, `${s} status preserved`);
  ok(p.report === undefined && p.error === undefined && p.incomplete_reason === undefined, `${s} carries no terminal fields`);
}

// --- no-regression: completed/failed/cancelled/in_progress are byte-identical to the OLD logic ---
for (const fx of [completed(), { id: 'x', status: 'failed', error: { m: 1 } }, { id: 'x', status: 'cancelled' }, { id: 'x', status: 'in_progress' }, { id: 'x', status: 'completed', output: [] }]) {
  eq(JSON.stringify(buildStatusPayload(fx)), JSON.stringify(oldBuildStatusPayload(fx)),
     `no-regression: ${fx.status} byte-identical to old logic`);
}

// --- robustness: missing/odd shapes never throw ---
{
  ok(buildStatusPayload({ id: 'x', status: 'completed' }).report === '', 'completed missing output -> empty report no throw');
  const u = buildStatusPayload({ id: 'x', status: 'weird' });
  ok(u.status === 'weird' && u.report === undefined, 'unknown status pass-through');
}

console.log(`research-openai-status: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
