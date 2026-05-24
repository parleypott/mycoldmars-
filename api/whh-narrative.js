import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 60 };

/**
 * Westchester House Hunter — multi-kind narrative generator.
 *
 *   POST /api/whh-narrative
 *   body: { kind, pin?, pins?, context, stream? }
 *
 *   kinds:
 *     'story'         — 200-word narrative: what it would be like for the Harris family to live here
 *     'visit-prep'    — markdown with 4 sections: ASK / WALK / INSPECT / COMPS
 *     'negotiation'   — one-page memo with comps, DOM, ceiling, suggested opening offer
 *     'decision-walk' — multi-frame analysis across top N homes (school-first, commute-first, fit-first)
 *     'brief'         — stakeholder one-pager for the spouse: where we are, top 3, the read
 *
 * Returns text/markdown (streamed if stream=true, else single shot).
 */

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed', 'POST only');
  const denied = await checkAccess(req);
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonError(500, 'misconfigured', 'ANTHROPIC_API_KEY missing');

  let body;
  try { body = await req.json(); } catch { return jsonError(400, 'bad_body', 'invalid JSON'); }
  const { kind, pin, pins, context, stream } = body || {};
  if (!kind) return jsonError(400, 'missing_kind', 'kind is required');

  const { system, userMsg, maxTokens } = buildPrompt({ kind, pin, pins, context });
  if (!system) return jsonError(400, 'unknown_kind', 'unknown kind: ' + kind);

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        stream: !!stream,
        system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
  } catch (err) {
    return jsonError(502, 'anthropic_unreachable', err?.message || String(err));
  }
  if (stream) {
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') || 'text/event-stream', 'Cache-Control': 'no-cache' }
    });
  }
  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    return jsonError(response.status, 'anthropic_error', txt.slice(0, 400));
  }
  const data = await response.json();
  const text = data?.content?.[0]?.text || '';
  return new Response(JSON.stringify({ kind, text, _ts: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function buildPrompt({ kind, pin, pins, context }) {
  const family = `Johnny Harris (filmmaker, creative-professional), spouse, Henry (13, autistic 2e), Ollie (9, neurotypical), Remi (Brittany spaniel). Moving from Falls Church VA → NYC metro.`;
  const doctrine = context?.familyCriteria || '(use general best-fit reasoning for a creative-professional family with an autistic teen + neurotypical 9yo)';
  const memory = (context?.memory || []).map((m, i) => `${i+1}. ${m.text || m}`).join('\n') || '(none saved)';

  if (kind === 'story') {
    return {
      maxTokens: 800,
      system: `You write a single 200-word narrative paragraph titled "What it would be like for the Harris family to live at this address." Plain editorial prose. Use the actual street, the actual village, the actual train station, the actual school district. Mention Henry and Ollie by name in concrete sensory detail — what Henry's morning would feel like there, what Ollie's afternoon would look like. Reference the family doctrine (creative-class fit, sensory profile, school philosophy) without naming it. No buzzwords, no real-estate marketing voice, no clichés. Lowercase if it feels right. End with a single honest sentence about the load-bearing trade-off this home represents for this family.`,
      userMsg: `Family: ${family}\n\nFAMILY DOCTRINE:\n${doctrine}\n\nMEMORY:\n${memory}\n\nHOME:\n${JSON.stringify(pin)}\n\nWrite the 200-word narrative now. Plain prose. No headings.`
    };
  }

  if (kind === 'visit-prep') {
    return {
      maxTokens: 1400,
      system: `You generate a tour-prep brief for a specific home Johnny is about to visit. Output markdown with FOUR sections in this exact order, each labeled with a level-3 heading:

### Ask the Broker
5–7 specific questions to ask, grounded in this home's actual data. Mention exact numbers where you have them (DOM if known, school district name, the actual train station). Skip generic real-estate questions. Lead with the questions whose answers would most change the family's read.

### Inspect (Henry-aware)
4–6 specific things to look at on the tour, with Henry's autism + sensory profile in mind. HVAC noise in bedrooms, light in his potential bedroom, proximity to busy roads, sensory load of the kitchen, whether there's a quiet retreat space. Be concrete to THIS home — use the address.

### Walking Tour
3–4 specific places to walk to from the house, with estimated walk times. The train station (use the named one in the data). The downtown / main street. The nearest park or trail (use the named one). A grocery if known. Make this useful for a same-day post-tour sense of place.

### Comps + CSE Contacts
2–3 sentences naming similar homes from the Westchester market and what they sold for (your knowledge of recent comps is approximate but useful for setting expectations). Plus the school district's CSE phone number if known, or "google '[district name] CSE contact'" otherwise.

Be specific. Use names. Don't hedge.`,
      userMsg: `Family: ${family}\n\nDOCTRINE:\n${doctrine}\n\nMEMORY:\n${memory}\n\nHOME:\n${JSON.stringify(pin)}\n\nGenerate the visit-prep brief now.`
    };
  }

  if (kind === 'negotiation') {
    return {
      maxTokens: 1200,
      system: `You write a one-page negotiation memo. Output markdown with FIVE sections:

### Position
2 sentences naming the home + asking price + (if known) days on market + recent price changes.

### Comps
3–4 bullets listing approximate comparable closed sales in the same village/school district in the last 90 days, with prices. Your knowledge is approximate — flag uncertainty with phrases like "based on typical [village] comps in this size band." Don't invent specific addresses you don't actually know.

### Family-Justified Ceiling
A single number and a sentence explaining how it was derived from the family doctrine (budget envelope, school value, commute value, sensory fit). Be honest if the asking price is above the ceiling.

### Suggested Opening
A single number, percent under asking, and a one-line rationale. Generally 5–10% under asking unless the home has been on market 60+ days, in which case go harder.

### Walk-Away
A single number — the price above which this home stops being a smart buy for this family, based on the doctrine. Name the reason.

Use real numbers. No hedging. No "consider," "you might want to."`,
      userMsg: `Family: ${family}\n\nDOCTRINE:\n${doctrine}\n\nMEMORY:\n${memory}\n\nHOME:\n${JSON.stringify(pin)}\n\nWrite the negotiation memo now.`
    };
  }

  if (kind === 'decision-walk') {
    return {
      maxTokens: 2200,
      system: `You facilitate a final-decision walk through the top homes. Output markdown with FIVE sections:

### The Three Frames
Identify three legitimate value frames a family in this situation could weight most heavily (e.g., school-fit-first, commute-first, sensory/Henry-first, creative-class-fit-first, value-first — choose the three most relevant to THESE homes). Name each frame in 1 short sentence.

### If School-Fit Matters Most
Name the winning home, briefly say why it wins on this frame, what it costs on other frames.

### If [Frame 2] Matters Most
Same structure.

### If [Frame 3] Matters Most
Same structure.

### What the Memory Says
Read Johnny's saved memory items. What pattern do they show about which frame he's actually been weighting? Name the leaning home given that pattern. Name the regret risk — what could go wrong if he picks this and the pattern shifts.

End with a single bolded recommendation sentence: "**Lean: [home]. Regret risk: [single phrase].**"

No hedging. Pick names. Make the call.`,
      userMsg: `Family: ${family}\n\nDOCTRINE:\n${doctrine}\n\nMEMORY:\n${memory}\n\nTOP HOMES (sorted by current score):\n${JSON.stringify(pins)}\n\nRun the decision walk now.`
    };
  }

  if (kind === 'brief') {
    return {
      maxTokens: 2000,
      system: `You write a stakeholder brief for Johnny's spouse — someone who is NOT in the tool daily but needs to absorb the state of the house hunt in 5 minutes. Output markdown with these sections:

### Where We Are
2–3 sentences: how many homes in the funnel, what the search has revealed about what we want, the next decision point.

### Top 3 Candidates
For each of the top 3 (by current score):
- **<address>** · score · price · school district
- one paragraph (~80 words) on what's strongest about this home for our family, and the one real concern
- the school district fit for Henry specifically, in one sentence

### My Read
2–3 honest sentences naming Johnny's current lean and why. No hedging.

### What I Need From You
A short list of 2–3 things to discuss with the spouse — these should be the actual cruxes (e.g., "are we OK with a 50min commute if the school is perfect," not generic prompts).

Voice: warm, direct, partner-to-partner. No real-estate jargon. No buzzwords. Lowercase ok where natural.`,
      userMsg: `Family: ${family}\n\nDOCTRINE:\n${doctrine}\n\nMEMORY:\n${memory}\n\nALL PINNED HOMES (top first):\n${JSON.stringify(pins)}\n\nWrite the brief now.`
    };
  }

  return { system: null, userMsg: null, maxTokens: 0 };
}

function jsonError(status, error, message) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
