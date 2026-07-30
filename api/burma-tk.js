// WP-01 Burma Script — the {TK} writing helper + fact-check backend.
// MIRRORS api/research-claude.js: an Edge handler that POSTs straight to the Anthropic
// Messages API with x-api-key / anthropic-version 2023-06-01 / claude-sonnet-4-5. No SDK.
//
// Two modes, picked by the `mode` field on the request:
//   mode:'tk'  → return FIVE distinct, ready-to-drop alternatives for a {TK} gap, each
//                tone/length/rhythm-matched to the surrounding script, with a brief source
//                line for any factual claim. Output replaces the {TK} marker in the doc.
//   mode:'fc'  → fact-check a claim: a verdict (true/false/unclear), a one-line finding,
//                a suggested corrected edit, and sources. Web search ON for fc.
//
// The {TK}/{fc} marker text + the block it sits in + nearby script come in as context so
// the model writes in Johnny's voice and at the right altitude — not generic filler.

import { readJsonBody } from './_lib/read-json-body.js';
import { checkAccess, readHeader } from './_lib/access.js';

// NODEJS runtime (not edge): the fc fact-check fires a multi-step Anthropic web_search that routinely
// runs longer than the edge function wall-clock limit (~25s). On edge that timed out and Vercel returned
// its own PLAIN-TEXT error page ("An error occurred…"), which the Workshop client then tried to JSON.parse
// → "Unexpected token 'A' … is not valid JSON". The nodejs runtime honors maxDuration (proven by
// api/nano-banana.js, which is nodejs + returns a web Response exactly like this handler), giving the web
// search room to finish. Belt-and-suspenders: an in-handler AbortController (below) returns a clean JSON
// timeout BEFORE the platform limit, so the client always gets JSON — never a platform error page.
// maxDuration 300 (was 60): mode:'fc-deep' runs up to 8 web_search uses with no time-budget
// pressure — the whole point is that NOBODY is watching a spinner (batch/background flow), so
// depth wins over latency. The interactive modes keep their own 50s deadline below; only deep
// uses the long runway. 300 mirrors api/cutter.js / api/transcribe.js on this plan.
export const config = { runtime: 'nodejs', maxDuration: 300 };

// Current Sonnet (claude-sonnet-4-5-20250929 was the legacy pin). Sonnet 4.6 pairs with the
// web_search_20260209 tool version (dynamic filtering — filters results in-container before they
// hit the context window), which is both faster and cheaper than the old 20250305 search loop.
const MODEL = 'claude-sonnet-4-6';

// HARD TIME BOUNDS — the guarantee is "VERIFY CLAIM always resolves within ~a minute".
//   server: abort the Anthropic call at 50s and return a clean JSON 504. This must sit BELOW
//           every platform cap (maxDuration above, and the 60s clamp some Vercel plans apply
//           regardless of the configured value) so the timeout is OURS — JSON, not an HTML
//           error page from the gateway.
//   client: Workshop.jsx carries its own 70s AbortController as the belt-and-suspenders bound.
export const FC_UPSTREAM_TIMEOUT_MS = 50_000;

// mode:'fc-deep' gets a 240s server deadline — under the 300s maxDuration with the same
// our-timeout-is-JSON margin the 50s bound keeps under 60. The batch client (verify-all.js)
// carries a 280s AbortController as its belt-and-suspenders bound.
export const FC_DEEP_TIMEOUT_MS = 240_000;

// ── Per-identity rate limit (in-memory token bucket) ──────────────────────────────────────────────
// burma-tk calls Anthropic on EVERY hit, so even an authenticated-but-scripted caller could run up
// real cost. This caps the burst + sustained rate PER identity (the caller's JWT when present, else
// their IP). Edge keeps the module alive across requests in the same instance, so this is BEST-EFFORT
// per-instance — same posture as access.js's JWT cache. It blunts abuse without any external store.
// Limit: a burst of RL_BURST requests, refilling RL_PER_MIN per minute. Documented, not perfect: a
// distributed spray across many edge instances is not fully bounded — that would need a shared KV.
// Batch compatibility note (Verify All, 2026-07-17): the background runner fans out
// mode:'fc-deep' at concurrency ≤3 with each call taking 1-4 minutes, so its steady-state
// request rate (~1-3/min) sits comfortably inside this bucket — no batch carve-out needed.
// If a future batch ever bursts past 20 fast calls/min, give it its own keyed budget rather
// than loosening the interactive one.
const RL_BURST = 20;
const RL_PER_MIN = 20;
const RL_MAX_KEYS = 1000;
const _buckets = new Map(); // key -> { tokens, last }

export function rateLimitCheck(key, now = Date.now()) {
  // Bound the map (drop oldest half) so a spray of distinct identities can't grow it unbounded.
  if (_buckets.size > RL_MAX_KEYS) {
    let drop = Math.floor(RL_MAX_KEYS / 2);
    for (const k of _buckets.keys()) { if (drop-- <= 0) break; _buckets.delete(k); }
  }
  let b = _buckets.get(key);
  if (!b) { b = { tokens: RL_BURST, last: now }; _buckets.set(key, b); }
  const refill = ((now - b.last) / 60000) * RL_PER_MIN;
  b.tokens = Math.min(RL_BURST, b.tokens + refill);
  b.last = now;
  if (b.tokens < 1) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / (RL_PER_MIN / 60))) };
  }
  b.tokens -= 1;
  return { allowed: true };
}

// Identity for the bucket: the caller's Bearer JWT (per-user) when present, else their forwarded IP.
export function identityKey(req) {
  const auth = readHeader(req, 'authorization');
  const m = /Bearer\s+(\S+)/i.exec(auth || '');
  if (m) return 'jwt:' + m[1].slice(0, 64);
  const fwd = readHeader(req, 'x-forwarded-for') || readHeader(req, 'x-real-ip') || '';
  return 'ip:' + (String(fwd).split(',')[0].trim() || 'unknown');
}

// Force structured JSON out of the model via a single tool the model MUST call. This is
// far more reliable than asking it to "return JSON" in prose and then regex-scraping.
const TK_TOOL = {
  name: 'emit_options',
  description: 'Return exactly five distinct written alternatives for the {TK} gap.',
  input_schema: {
    type: 'object',
    properties: {
      options: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The ready-to-drop line(s) that REPLACE the {TK} marker. No braces, no label — just the prose, in the script\'s voice.' },
            angle: { type: 'string', description: '2-4 word label for how this option differs (e.g. "tight + factual", "lyrical", "punchy one-liner").' },
            source: { type: 'string', description: 'Brief source for any factual claim ("est. ~20 EAOs, Council on Foreign Relations 2023"). Empty string if purely stylistic.' },
          },
          required: ['text', 'angle', 'source'],
        },
      },
    },
    required: ['options'],
  },
};

const FC_TOOL = {
  name: 'emit_verdict',
  description: 'Return a fact-check verdict for the claim, with a corrected edit and sources.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['true', 'false', 'partly', 'unclear'], description: 'Overall verdict on the claim.' },
      finding: { type: 'string', description: 'One or two sentences stating what the evidence says.' },
      suggestedEdit: { type: 'string', description: 'A corrected, ready-to-drop line that REPLACES the {fc} marker — the verified fact written in the script\'s voice. No braces.' },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, url: { type: 'string' } },
          required: ['label'],
        },
      },
    },
    required: ['verdict', 'finding', 'suggestedEdit', 'sources'],
  },
};

// mode:'fc-deep' — the BATCH-GRADE fact check. Same claim-in, verdict-out contract as fc,
// but built for the background Verify All flow where nobody is watching a spinner, so the
// latency ceiling lifts and the RIGOR floor rises. Methodology ported from the Kenneth
// (Newpress Hermes) Iran-citation pipeline, June 2026 — the run that went from five
// fabricated sources (monolithic drafting) to zero hallucinations across 90 rows by making
// grounding quotes mandatory and schema-enforced: no verbatim quote, no source. The schema
// is a superset of FC_TOOL's output, so the Workshop's verdict renderer works unchanged and
// richer fields (claims[], per-source quotes) light up where the UI knows about them.
const FC_DEEP_TOOL = {
  name: 'emit_deep_verdict',
  description: 'Return a deep, grounded fact-check: per-claim verdicts, a corrected edit, and sources each carrying a verbatim grounding quote.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['true', 'false', 'partly', 'unclear'], description: 'Overall verdict across all claims in the marker.' },
      finding: { type: 'string', description: 'Two to four sentences: what the evidence establishes, including any conflict between sources.' },
      suggestedEdit: { type: 'string', description: 'A corrected, ready-to-drop line that REPLACES the {fc} marker — the verified fact in the script\'s plain VO voice. No braces.' },
      claims: {
        type: 'array',
        minItems: 1,
        description: 'The marker decomposed into its distinct factual claims, each judged separately.',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string', description: 'One atomic factual claim extracted from the marker.' },
            verdict: { type: 'string', enum: ['true', 'false', 'partly', 'unclear'] },
            finding: { type: 'string', description: 'One line: what the evidence says about THIS claim.' },
          },
          required: ['claim', 'verdict'],
        },
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Attribution in broadcast-citation form: author (if any), exact title as the publisher prints it, publication, date/pages. NEVER a guessed author — omit the author if unsure.' },
            url: { type: 'string', description: 'Direct URL. Empty string if unavailable (books, archives).' },
            quote: { type: 'string', description: 'VERBATIM ~20-50 word excerpt from THIS source that supports the specific claim — exact words, never a paraphrase. A source without a real quote must not be emitted at all.' },
            kind: { type: 'string', enum: ['corpus', 'primary', 'news', 'encyclopedia', 'other'], description: "'corpus' when it came from the VETTED NEWPRESS SOURCES provided in the prompt." },
          },
          required: ['label', 'quote'],
        },
      },
    },
    required: ['verdict', 'finding', 'suggestedEdit', 'claims', 'sources'],
  },
};

export function deepPrompt({ marker, block, context, corpus, today }) {
  const corpusSection = corpus && corpus.length
    ? `\nVETTED NEWPRESS SOURCES — research this team has already vetted and trusts. CHECK THESE FIRST: if a vetted source grounds a claim, cite it (kind: "corpus") before reaching for the open web. Use web_search only for claims these do not cover, or to check whether a vetted source has been superseded.\n\n${corpus.map((c, i) => `[NP-${i + 1}] ${c.label}${c.url ? ` <${c.url}>` : ''}\n${c.text}`).join('\n\n')}\n`
    : '';
  return `You are deep-fact-checking a claim in Johnny Harris's Burma/Myanmar documentary script. This runs in the BACKGROUND — no one is waiting on you, so favor rigor over speed. You have up to 8 web_search uses; search iteratively (search, read, refine, search again) until the evidence is settled or exhausted. Today is ${today} — anchor time-sensitive facts to this date and prefer the most recent authoritative reporting for anything still unfolding.

CLAIM / FACT NEEDED: ${marker}

Surrounding block: ${block || '(none)'}
Nearby script: ${context || '(none)'}
${corpusSection}
METHOD — follow exactly:
1. DECOMPOSE: break the marker into its distinct factual claims (dates, quantities, names, causation, quotes). Judge each claim separately in claims[].
2. SOURCE RUBRIC: prefer primary documents (treaties, official records, contemporaneous reporting, scholarly monographs with page numbers) over brand-name encyclopedias. Copy titles exactly as the publisher prints them. NEVER guess an author, volume, or page number — omit what you are not sure of.
3. CONFLICT RULE: when reputable sources disagree, the verdict is "partly" or "unclear" and the finding states both positions with their sources — never silently pick a side.
4. HARD GROUNDING RULE — non-negotiable: every source you emit MUST carry a verbatim ~20-50 word quote from that source's own text (from a vetted Newpress source above or from a page you actually saw in web_search results) that supports the specific claim. If you cannot quote it, you cannot cite it. If no claim can be grounded, return verdict "unclear" with an empty sources array and say in the finding exactly what you searched and what was missing — never fabricate a plausible-sounding source.

Then call emit_deep_verdict exactly once: overall verdict, finding, suggestedEdit (the corrected fact as a ready-to-drop line in the script's plain VO voice, no braces), claims[], and grounded sources[].`;
}

// mode:'quote' — the footnote RECHECK. Not a fresh verdict: a hunt for the SPECIFIC
// quotation/blurb inside reputable sources that checks the fact, returned verbatim so the
// receipt in the script can cite the exact sentence.
const QUOTE_TOOL = {
  name: 'emit_quotes',
  description: 'Return the specific verbatim quotations from sources that verify (or refute) the claim.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['true', 'false', 'partly', 'unclear'], description: 'What the quoted evidence establishes.' },
      finding: { type: 'string', description: 'One line: what the sourced quotes establish, plainly.' },
      quotes: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            quote: { type: 'string', description: 'The VERBATIM sentence(s) from the source that check the fact — an exact quotation or tight excerpt, never a paraphrase.' },
            source: { type: 'string', description: 'Publication + piece + date, e.g. "Reuters, 2024-03-02 — Myanmar fuel crisis deepens".' },
            url: { type: 'string', description: 'Direct URL of the piece. Empty string if unavailable.' },
          },
          required: ['quote', 'source'],
        },
      },
    },
    required: ['verdict', 'finding', 'quotes'],
  },
};

export function quotePrompt({ marker, block, context }) {
  return `You are re-checking a fact in Johnny Harris's Burma/Myanmar documentary script. The fact was already checked once; what's needed NOW is the RECEIPT — the specific quotation or short excerpt from a reputable source that verifies (or refutes) it. Time budget: at most 3 web_search uses (prefer 1-2 well-chosen queries), then commit. If you can't surface a verbatim quote, call emit_quotes anyway with verdict "unclear" and the closest sourced excerpt you found — never keep searching.

  CLAIM: ${marker}

Script block it lives in: ${block || '(none)'}
Existing fact-check notes/sources (start from these — if they name a source, pull the quote FROM it): ${context || '(none)'}

Find the exact supporting sentence(s). Quote them VERBATIM — the writer needs the actual words from the source, not your summary. Then call emit_quotes exactly once.`;
}

export function tkPrompt({ marker, block, context }) {
  return `You are a writing partner for Johnny Harris's documentary about Burma/Myanmar (The Human Element). The script is voice-over for a cinematic explainer — plain, vivid, emotionally grounded, never academic or marketing-shouty. One idea per line. Lowercase-friendly, declarative.

A {TK} marker is a GAP the writer left for you to fill. The marker text describes what's needed:

  GAP NEEDED: ${marker}

It sits inside this block of the script:

  BLOCK: ${block || '(no surrounding block)'}

Nearby script for tone/rhythm/voice:

  CONTEXT: ${context || '(no extra context)'}

Write FIVE genuinely DISTINCT alternatives that could REPLACE the {TK} marker in place. Match the surrounding sentence so the line reads continuously — if the gap is mid-sentence, write a fragment that completes it; if it's a whole line, write a whole line. Vary the five across: length (one tight, one fuller), rhythm, and angle (factual / lyrical / punchy). For any factual claim, put a brief real source in the source field. Do NOT include the curly braces. Call emit_options exactly once.`;
}

export function fcPrompt({ marker, block, context }) {
  return `You are fact-checking a claim in Johnny Harris's Burma/Myanmar documentary script. You have a strict time budget: use web_search efficiently (at most 3 searches — prefer 1-2 well-chosen queries), then commit to a verdict. If the evidence is thin after your searches, call emit_verdict anyway with verdict "unclear" and say what you found — never keep searching. The {fc} marker states the claim or the fact to nail down:

  CLAIM / FACT NEEDED: ${marker}

Surrounding block: ${block || '(none)'}
Nearby script: ${context || '(none)'}

Verify against primary/reputable sources. Then call emit_verdict exactly once with: a verdict, a one-line finding, a suggestedEdit (the corrected fact written as a ready-to-drop line in the script's plain VO voice, no braces — this replaces the {fc} marker), and sources.`;
}

async function innerHandler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  // SIGN-IN GATE (audit finding M): burma-tk was unauthenticated — anyone could hit it and burn
  // Anthropic tokens. Require the SAME gate the app uses (valid x-access-code OR a verified Supabase
  // Bearer JWT). The Workshop UI sends the Bearer via the library gate.js fetch interceptor, so the
  // request/response shape is UNCHANGED for logged-in callers. In dev (ACCESS_CODE unset) checkAccess
  // returns null and this is a no-op, exactly as the other gated endpoints behave.
  const denied = await checkAccess(req);
  if (denied) return denied;

  // Shared safe body read: malformed JSON OR a non-object body (a JSON literal
  // `null`, number, string, array) is a clean 400, never an unhandled 500 — the
  // null-body crash class fixed across the research-* endpoints (was: `body.mode`
  // on a null body threw a TypeError -> 500).
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;

  const mode = body.mode === 'fc' ? 'fc' : body.mode === 'quote' ? 'quote' : body.mode === 'fc-deep' ? 'fc-deep' : 'tk';
  const marker = typeof body.marker === 'string' ? body.marker.trim() : '';
  const block = typeof body.block === 'string' ? body.block.slice(0, 2000) : '';
  const context = typeof body.context === 'string' ? body.context.slice(0, 3000) : '';
  // Corpus seam (deep mode only): pre-vetted Newpress research chunks the client (or a future
  // retrieval layer) wants checked BEFORE the open web. Validated + clipped hard so a bad
  // caller can't balloon the prompt: ≤12 chunks, each ≤1500 chars text / ≤200 label / ≤300 url.
  const corpus = mode === 'fc-deep' && Array.isArray(body.corpus)
    ? body.corpus.slice(0, 12).map((c) => ({
        label: typeof c?.label === 'string' ? c.label.slice(0, 200) : '',
        text: typeof c?.text === 'string' ? c.text.slice(0, 1500) : '',
        url: typeof c?.url === 'string' ? c.url.slice(0, 300) : '',
      })).filter((c) => c.text)
    : [];

  if (!marker) return json({ error: 'marker required' }, 400);
  // Cost guard — mirror research-claude.js. Cap the marker length too.
  if (marker.length > 1200) return json({ error: 'marker too long' }, 413);

  // RATE LIMIT — only genuine, validated requests (which are the ones that would call Anthropic) count
  // against the bucket; cheap 400/405/413 rejects above do not consume tokens. Keyed per identity.
  const rl = rateLimitCheck(identityKey(req));
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'rate limited', message: 'Too many requests — slow down and try again shortly.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfter) },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set on server' }, 500);

  const isFc = mode === 'fc' || mode === 'quote' || mode === 'fc-deep'; // all web_search modes
  const isDeep = mode === 'fc-deep';
  const payload = buildPayload(mode, { marker, block, context, corpus, today: new Date().toISOString().slice(0, 10) });

  // HARD DEADLINE via Promise.race — not just an AbortController on the fetch.
  //
  // POST-MORTEM (measured in prod 2026-07-06): the previous version armed an AbortController(100s)
  // around the fetch only, then cleared it before reading the body. A live fc request rode straight
  // past 100s to the 120s maxDuration platform kill and returned Vercel's PLAIN-TEXT
  // FUNCTION_INVOCATION_TIMEOUT page — the in-handler abort never delivered its JSON. The race
  // below removes every dependence on undici's signal plumbing: whichever settles first WINS the
  // handler, so the timeout branch returns clean JSON no matter where the upstream work is stuck
  // (connect, headers, body read, parse). The abort is still fired as cleanup so the orphaned
  // request doesn't keep the instance busy.
  const ac = new AbortController();
  const TIMED_OUT = Symbol('timed-out');
  // Test hook: BURMA_TK_TIMEOUT_MS lets the suite exercise the timeout branch in milliseconds
  // instead of waiting 50 real seconds. Unset in prod → FC_UPSTREAM_TIMEOUT_MS.
  const timeoutMs = Number(process.env.BURMA_TK_TIMEOUT_MS) > 0
    ? Number(process.env.BURMA_TK_TIMEOUT_MS)
    : isDeep ? FC_DEEP_TIMEOUT_MS : FC_UPSTREAM_TIMEOUT_MS;
  // NOTE: deliberately NOT unref()'d — an unref'd timer never fires once the loop drains (e.g.
  // the upstream promise is the only pending work), which would silently disarm the deadline.
  // The race clears it the moment either branch settles, so it can't leak.
  let deadlineTimer;
  const deadline = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => { ac.abort(); resolve(TIMED_OUT); }, timeoutMs);
  });

  const upstream = (async () => {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') return TIMED_OUT;
      return json({ error: `anthropic unreachable: ${err?.message || err}` }, 502);
    }

    if (!res.ok) {
      const t = await res.text();
      return json({ error: `anthropic ${res.status}: ${t.slice(0, 400)}` }, 502);
    }

    const data = await res.json();
    // Pull the tool_use block (the structured output). For fc the model may emit text +
    // server_tool_use (web_search) blocks too — find the one matching our tool name.
    const toolName = mode === 'quote' ? QUOTE_TOOL.name : mode === 'fc-deep' ? FC_DEEP_TOOL.name : mode === 'fc' ? FC_TOOL.name : TK_TOOL.name;
    let toolInput = null;
    for (const b of data.content ?? []) {
      if (b.type === 'tool_use' && b.name === toolName) { toolInput = b.input; break; }
    }

    if (!toolInput) {
      // Fallback: the model answered in prose instead of calling the tool. Surface the text
      // so the client can at least show SOMETHING rather than a blank panel.
      const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return json({ error: 'model did not return structured output', raw: text.slice(0, 600) }, 502);
    }

    if (mode === 'quote') {
      return json({ mode: 'quote', ...toolInput });
    }
    if (mode === 'fc-deep') {
      return json({ mode: 'fc-deep', ...toolInput });
    }
    if (isFc) {
      return json({ mode: 'fc', ...toolInput });
    }
    // Defensive: ensure 5 options, each with the expected shape.
    const options = Array.isArray(toolInput.options) ? toolInput.options.slice(0, 5) : [];
    return json({ mode: 'tk', options });
  })().catch((err) => {
    // Any unexpected throw inside the upstream work (body read aborted mid-stream, bad JSON from a
    // proxy, …) resolves the race with clean JSON instead of crashing the function into a platform
    // error page.
    if (err?.name === 'AbortError') return TIMED_OUT;
    return json({ error: `upstream failed: ${err?.message || err}` }, 502);
  });

  const winner = await Promise.race([upstream, deadline]);
  clearTimeout(deadlineTimer);
  if (winner === TIMED_OUT) {
    return json({
      error: isDeep
        ? `deep check hit the ${Math.round(timeoutMs / 1000)}s ceiling — the claim may be very compound. Re-run it, or split the marker.`
        : isFc
          ? `couldn't verify in ${Math.round(timeoutMs / 1000)}s — the web search ran long. Try again, or shorten the claim.`
          : `the writing helper timed out — try again.`,
      timeout: true,
    }, 504);
  }
  return winner;
}

// Exported for tests: the exact Anthropic request body per mode. fc gets the current-generation
// web_search tool (20260209 — dynamic filtering, results filtered before they hit context) capped
// at 3 uses (was 5 — the biggest single latency lever), on the current Sonnet.
export function buildPayload(mode, { marker, block, context, corpus, today }) {
  const webMode = mode === 'fc' || mode === 'quote' || mode === 'fc-deep'; // tk is generation-only
  const tool = mode === 'quote' ? QUOTE_TOOL : mode === 'fc-deep' ? FC_DEEP_TOOL : mode === 'fc' ? FC_TOOL : TK_TOOL;
  const prompt = mode === 'quote' ? quotePrompt({ marker, block, context })
    : mode === 'fc-deep' ? deepPrompt({ marker, block, context, corpus, today })
    : mode === 'fc' ? fcPrompt({ marker, block, context })
    : tkPrompt({ marker, block, context });
  // Deep: 8 searches (vs 3 interactive) + a bigger output ceiling — claims[] + per-source
  // grounding quotes are materially larger than the shallow verdict.
  const maxUses = mode === 'fc-deep' ? 8 : 3;
  return {
    model: MODEL,
    max_tokens: mode === 'fc-deep' ? 4000 : 2000,
    tools: webMode
      ? [tool, { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }]
      : [tool],
    tool_choice: webMode ? { type: 'auto' } : { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: prompt }],
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ────────────────────── Vercel Node adapter ──────────────────────
// THE "CHECKING… 60s → FUNCTION_INVOCATION_TIMEOUT" ROOT CAUSE (reproduced in prod 2026-07-06):
// this handler was moved to `runtime: 'nodejs'` (for maxDuration) but kept the WEB handler shape —
// `handler(req) -> Response`. Vercel's Node runtime invokes the default export with
// (IncomingMessage, ServerResponse) and IGNORES a returned web Response, so `res` was never ended
// and EVERY request — even a bare GET that should be an instant 405 — hung to the 60s platform
// wall and came back as Vercel's plain-text error page. The 50s Promise.race deadline above never
// mattered: its clean JSON 504 was returned into the void.
//
// nano-banana.js (the endpoint this file's runtime comment pointed at as proof) works precisely
// because it carries this adapter — mirrored here: Node-style (req, res) is bridged into a web
// Request, innerHandler runs unchanged, and the web Response is written back through `res`.
// Web-style single-arg invocation (edge, tests, the vite dev middleware) passes straight through.

async function buildWebRequest(req) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost';
  const url = `${proto}://${host}${req.url || '/'}`;
  // Body: Vercel's Node adapter pre-parses JSON onto req.body when the request has
  // Content-Type: application/json. If not, fall back to reading the raw stream.
  let body;
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body !== undefined && req.body !== null) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      body = await new Promise((resolve, reject) => {
        let buf = '';
        req.on('data', (chunk) => { buf += chunk; });
        req.on('end', () => resolve(buf));
        req.on('error', reject);
      });
    }
  }
  return new Request(url, { method, headers, body: body || undefined });
}

async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  for (const [k, v] of response.headers) res.setHeader(k, v);
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

export default async function handler(req, res) {
  // Express-style — Node runtime (what Vercel actually calls with runtime:'nodejs').
  if (res !== undefined) {
    try {
      const webReq = await buildWebRequest(req);
      const response = await innerHandler(webReq);
      await sendWebResponse(res, response);
    } catch (e) {
      console.error('[burma-tk]', e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'INTERNAL', message: (e && e.message) || String(e) }));
    }
    return;
  }
  // Web-style — single-arg invocation (edge fallback, unit tests, dev middleware).
  return innerHandler(req);
}
