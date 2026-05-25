// queen-scarlet-school: detect scene-break offsets inside a long block.
//
// Two passes, merged:
//   1. DETERMINISTIC pre-pass — regex scan for explicit movie-direction
//      cuts ("Cut to:", "Meanwhile,", "Back at...", time jumps like
//      "three weeks earlier", "the next morning", etc.) These ALWAYS
//      become breaks, full stop. The LLM cannot accidentally omit them.
//   2. LLM pass — Claude reads the full text and proposes additional
//      offsets for subtler shifts (new characters, setting changes,
//      tonal swings, surprising new images).
//
// Results are merged, deduped (within 80 chars of each other), sorted,
// and snapped to sentence boundaries. The LLM cap of 16 breaks total
// is enforced AFTER the merge so explicit cuts never get dropped.
//
// Body: { text: string, world?: string }
// Response: { breaks: [{ offset, label, why, source: 'rule' | 'llm' }] }

import { checkAccess } from './_lib/access.js';
import { canonOverlayForBody } from './_lib/qss-worlds.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

const SYSTEM = `You are a picture-book art director. You read a block of a kid's story and decide where the ILLUSTRATION should change. Your output is a list of character offsets where a new picture would help the reader.

PHILOSOPHY:
One picture per beat. A "beat" is a unit of visual life — a single moment a single image could show. Most stories have 3-10 beats per page. When in doubt, BREAK MORE OFTEN rather than less. Empty walls of text with no picture changes are worse than slightly redundant pictures.

ALWAYS BREAK AT (these are MANDATORY — never skip them):
1. EXPLICIT MOVIE CUTS — the text literally tells you the scene is changing:
   - "Cut to:" / "Cut back to:"
   - "Meanwhile," / "Meanwhile in..."
   - "Back at..." / "Back in..."
   - Time jumps: "three weeks earlier", "the next morning", "an hour later", "later that day", "moments later", "years before"
   - "[Setting], [time]." — script-like setting labels
   These are the EASIEST possible breaks. Missing one is a disqualifying error. Even if many cuts cluster together, break at every single one.

2. A NEW NAMED CHARACTER takes the stage — first appearance in this block of someone with a name and dialogue.

3. SETTING CHANGE — a different room, a different building, a different planet, indoors→outdoors, a flashback, a dream sequence.

4. BIG TONAL SWING — calm → chaos, dialogue → action, public → private, group → solo, comedy → emotion.

5. A SURPRISING NEW IMAGE enters the story — a giant cardboard box, a forklift, a glowing barrel, a check, an object that didn't exist a sentence ago.

DO NOT BREAK AT:
- Every sentence, every paragraph, every line of dialogue.
- Small camera moves that the same picture could cover.
- A character pausing or thinking inside the same beat.
- Reaction lines that are part of the same exchange.

OFFSET RULES:
- The offset is the character index in the INPUT text where the new picture starts being relevant.
- Use the START of the sentence (or the cut line, or the character's entrance sentence).
- Offsets must be > 0 and < text.length.
- Offsets in strictly increasing order.
- Two breaks within 80 characters of each other are too close — pick one.

EXAMPLE INPUT/OUTPUT:

INPUT TEXT:
"The next morning started like every other morning. But something was different. Every student had a large cardboard box at their desk. Scarlet burst in. 'Students!' she announced. Cut to: Mark Rober's YouTube Studio, three weeks earlier. Mark sat at his desk, staring at the contract."

EXPECTED OUTPUT:
{
  "breaks": [
    { "offset": 76, "label": "the boxes appear", "why": "surprising new image — orange cardboard boxes" },
    { "offset": 142, "label": "Scarlet enters", "why": "new character enters with dialogue" },
    { "offset": 184, "label": "Cut to Mark's studio", "why": "EXPLICIT CUT + time jump + setting change — this is mandatory" }
  ]
}

Note the third break — even though it's only a few sentences from the previous one, it's an EXPLICIT MOVIE CUT and those are mandatory. Spacing rules never override explicit cuts.

OUTPUT — strict JSON, no prose outside the object:

{ "breaks": [ { "offset": number, "label": "short phrase", "why": "one-sentence reason" }, ... ] }

If the text is short (<300 chars) or there are no natural breaks, return { "breaks": [] }.
Cap at 16 breaks total.`;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// Find explicit movie-direction cuts in text. Returns array of
// { offset, label, why, source: 'rule' }. Deterministic — no LLM.
function findExplicitCuts(text) {
  const out = [];
  const patterns = [
    { re: /\bCut to:?\s*([^.\n]{2,80})/gi,                                  label: (m) => `cut to ${m[1].trim().slice(0, 60)}` },
    { re: /\bCut back to:?\s*([^.\n]{2,80})/gi,                             label: (m) => `cut back to ${m[1].trim().slice(0, 60)}` },
    { re: /\bMeanwhile,?\s*(?:in\s+|at\s+|on\s+|back\s+)?([^.\n]{2,80})/gi, label: (m) => `meanwhile ${(m[1] || '').trim().slice(0, 60)}` },
    { re: /\bBack at\s+([^.\n]{2,80})/gi,                                   label: (m) => `back at ${m[1].trim().slice(0, 60)}` },
    { re: /\bBack in\s+([^.\n]{2,80})/gi,                                   label: (m) => `back in ${m[1].trim().slice(0, 60)}` },
    { re: /\b(?:Three|Two|Four|Five|Six|Seven|Eight|Nine|Ten|A few|Several)\s+(?:weeks?|days?|months?|years?|hours?|minutes?)\s+(?:earlier|later|before|after)\b/gi, label: (m) => m[0].toLowerCase() },
    { re: /\b(?:The next|That)\s+(?:morning|afternoon|evening|night|day|week|month|year)\b/gi,                                                                       label: (m) => m[0].toLowerCase() },
    { re: /\b(?:Hours?|Minutes?|Moments?|Days?|Weeks?|Months?|Years?)\s+(?:later|earlier|before|after|passed)\b/gi,                                                  label: (m) => m[0].toLowerCase() },
    { re: /\bLater that\s+(?:day|night|morning|evening|afternoon|week)\b/gi,                                                                                          label: (m) => m[0].toLowerCase() },
    { re: /\bSuddenly,?\s+([A-Z][^.\n]{3,80})/g,                            label: (m) => `suddenly ${m[1].trim().slice(0, 60)}` },
  ];
  for (const p of patterns) {
    let m;
    p.re.lastIndex = 0;
    while ((m = p.re.exec(text)) !== null) {
      const idx = m.index;
      if (idx <= 0) continue;
      out.push({
        offset: idx,
        label: typeof p.label === 'function' ? p.label(m) : p.label,
        why: 'explicit cut',
        source: 'rule',
      });
    }
  }
  // Dedupe TRULY overlapping pattern hits — e.g. "Cut to: Mark's
  // studio, three weeks earlier" triggers BOTH the "Cut to" pattern
  // AND the "three weeks earlier" pattern within the SAME physical
  // cut text. 50 chars absorbs those overlapping captures while
  // preserving legitimately distinct adjacent cuts ("Meanwhile, X. The
  // next morning, Y" — typically >50 chars between the two).
  out.sort((a, b) => a.offset - b.offset);
  const dedup = [];
  for (const c of out) {
    if (dedup.length && (c.offset - dedup[dedup.length - 1].offset) < 50) continue;
    dedup.push(c);
  }
  return dedup;
}

// Move offset backwards to the start of the current sentence
function snapToSentenceStart(text, offset) {
  const lo = Math.max(0, offset - 400);
  for (let i = offset; i >= lo; i--) {
    if (i === 0) return 0;
    const c = text[i - 1];
    if (/[.!?]/.test(c) && /\s/.test(text[i] || '') && /[A-Z"“'']/.test(text[i + 1] || '')) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      return j;
    }
  }
  return offset;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const denied = await checkAccess(req);
  if (denied) {
    const h = new Headers(denied.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(denied.body, { status: denied.status, headers: h });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const text = String(body.text || '').slice(0, 12000);
  if (!text.trim()) return json(200, { breaks: [] });
  if (text.length < 300) return json(200, { breaks: [] });

  // ─ Deterministic pre-pass ─
  const ruleBreaks = findExplicitCuts(text);

  // ─ LLM pass ─
  let llmBreaks = [];
  try {
    const llmRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SYSTEM + canonOverlayForBody(body),
        messages: [{
          role: 'user',
          content: `Find the image-break offsets inside this story block. Return the JSON object only.\n\nTEXT (length=${text.length}):\n${text}`,
        }],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (llmRes.ok) {
      const llmJson = await llmRes.json();
      const rawText = llmJson?.content?.[0]?.text || '';
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed.breaks)) {
          llmBreaks = parsed.breaks
            .filter(b => b && typeof b === 'object')
            .map(b => ({
              offset: Math.floor(Number(b.offset)),
              label: String(b.label || '').slice(0, 80),
              why: String(b.why || '').slice(0, 240),
              source: 'llm',
            }))
            .filter(b => Number.isFinite(b.offset) && b.offset > 0 && b.offset < text.length);
        }
      } catch (e) {
        // soft fail — rule pass still provides the explicit cuts
      }
    }
  } catch (e) {
    // soft fail — rule pass still provides the explicit cuts
  }

  // ─ Merge ─
  // Explicit cuts ALWAYS win. After they're seated, LLM breaks fill in
  // the gaps but cannot displace a rule break OR sit within 80 chars
  // of one. Then we snap everything to sentence starts and enforce
  // overall 80-char minimum spacing (between LLM-LLM pairs only; rule
  // breaks are never filtered out).
  const merged = ruleBreaks.slice();
  for (const lb of llmBreaks) {
    // Skip if too close to an existing break
    if (merged.some(m => Math.abs(m.offset - lb.offset) < 80)) continue;
    merged.push(lb);
  }
  merged.sort((a, b) => a.offset - b.offset);

  // Snap each to sentence starts
  for (const b of merged) b.offset = snapToSentenceStart(text, b.offset);

  // After snapping, two breaks could collide. Deduplicate while
  // preferring rule-source breaks.
  const deduped = [];
  for (const b of merged) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.offset - b.offset) < 80) {
      // Prefer rule over llm
      if (last.source !== 'rule' && b.source === 'rule') {
        deduped[deduped.length - 1] = b;
      }
      continue;
    }
    deduped.push(b);
  }

  // Cap total (rule breaks first to guarantee survival)
  const finalBreaks = [];
  for (const b of deduped) {
    if (finalBreaks.length >= 16) break;
    finalBreaks.push(b);
  }

  return json(200, { breaks: finalBreaks });
}
