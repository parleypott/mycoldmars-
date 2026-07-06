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
export const config = { runtime: 'nodejs', maxDuration: 60 };

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

// ── Per-identity rate limit (in-memory token bucket) ──────────────────────────────────────────────
// burma-tk calls Anthropic on EVERY hit, so even an authenticated-but-scripted caller could run up
// real cost. This caps the burst + sustained rate PER identity (the caller's JWT when present, else
// their IP). Edge keeps the module alive across requests in the same instance, so this is BEST-EFFORT
// per-instance — same posture as access.js's JWT cache. It blunts abuse without any external store.
// Limit: a burst of RL_BURST requests, refilling RL_PER_MIN per minute. Documented, not perfect: a
// distributed spray across many edge instances is not fully bounded — that would need a shared KV.
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

export default async function handler(req) {
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

  const mode = body.mode === 'fc' ? 'fc' : 'tk';
  const marker = typeof body.marker === 'string' ? body.marker.trim() : '';
  const block = typeof body.block === 'string' ? body.block.slice(0, 2000) : '';
  const context = typeof body.context === 'string' ? body.context.slice(0, 3000) : '';

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

  const isFc = mode === 'fc';
  const payload = buildPayload(mode, { marker, block, context });

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
    : FC_UPSTREAM_TIMEOUT_MS;
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
    const toolName = isFc ? FC_TOOL.name : TK_TOOL.name;
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
      error: isFc
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
export function buildPayload(mode, { marker, block, context }) {
  const isFc = mode === 'fc';
  const tool = isFc ? FC_TOOL : TK_TOOL;
  return {
    model: MODEL,
    max_tokens: 2000,
    tools: isFc
      ? [tool, { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }]
      : [tool],
    tool_choice: isFc ? { type: 'auto' } : { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: isFc ? fcPrompt({ marker, block, context }) : tkPrompt({ marker, block, context }) }],
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
