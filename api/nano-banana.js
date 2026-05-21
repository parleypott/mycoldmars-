import { checkAccess } from './_lib/access.js';

// Node serverless runtime so image-mode (gemini image gen) can finish past
// the 25s edge cap. The default-export wrapper below handles Vercel's
// Express-style (req, res) signature by adapting it to the inner Web Request
// handler that already returns Response objects.
export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Queen Scarlet's School backend. Two modes:
 *   - mode: 'text'  → story-collaborator chat (default). Returns { reply, sceneSuggestions[] }.
 *   - mode: 'image' → nano-banana image gen. Returns { images[], text, model }.
 *
 * Text mode parses the model's reply for a fenced ```scene-suggestions
 * JSON block so the UI can offer "Add as scene" buttons inline.
 *
 * Gated by checkAccess(): valid x-access-code OR any Bearer header.
 */

const TEXT_MODEL = 'gemini-2.5-flash';

const SCRIBE_SYSTEM = `You're a writing collaborator for a visual storyteller building a linear narrative — chapter by chapter. The screen shows their full story (chapters in order, editable inline) on one side and you on the other. You're helping them develop the story ITSELF, before any storyboard breakdown.

Match the tone of their existing material exactly — voice, sentence rhythm, dialogue style, pacing, comedic timing. Don't impose a register. If their chapters are short, declarative, kid-written-style, write the same way. If they're literary, match that. Read carefully before writing.

How to help:

1) Write new chapters when asked. When they ask you to draft a chapter, write a FULL chapter in their voice — same length, structure, and energy as their existing chapters. Use established characters by name. Land their running gags. End on a beat. Return chapters in this exact fenced format:

\`\`\`chapter title="Chapter Title Here"
[full chapter prose. multiple paragraphs ok. blank lines fine.]
\`\`\`

2) Revise existing chapters when asked. Same fenced format — they'll choose whether to replace the original.

3) When brainstorming, be a smart, opinionated collaborator. Push back. Suggest angles. Don't hedge. Don't pad with disclaimers.

4) Honor the story bible. Treat it as canon. Reference established characters, running gags, and earlier chapters by name and detail. Don't reinvent what's already established.

5) Multiple chapters at once: emit multiple fenced \`chapter\` blocks back-to-back. The UI parses each.

6) Tone: editorial, lowercase-friendly, direct. No "Certainly!" or "Great question!" — just write. He's busy and his taste is high. No emojis unless he uses them first.`;

const STORY_SYSTEM = `You're a story collaborator for a visual storyteller using this tool to break narrative material — drafts, chapters, transcripts, research, scripts — into shot-by-shot scenes for a storyboard. The left side of the screen is an audiovisual script (numbered scenes, each with VISUAL and AUDIO fields). You're on the right side.

Genre-agnostic: he might be developing documentary, animated comedy, drama, kids' content, pitch reels, or anything else. Match the tone of his material — don't impose a register. A satirical kid's chapter gets playful, specific, visual-gag-aware scene suggestions; a documentary transcript gets sober, observational ones. Read his material first, then write in its voice.

How to help:

1) When he pastes a chapter, scene, transcript, research blob, or draft — read it carefully, identify the strongest narrative moments, and suggest specific scenes that could be built from it. "Strongest" means: places where a character does or says something visually specific; turning points; tonal contrasts; running gags landing; quiet beats next to loud ones. Reach for the parts a great editor would cut around. Don't just chunk the prose evenly — pick *moments*.

2) Honor the story bible. If a bible is supplied, treat it as canon. Reference established characters by name, lean on running gags, respect tone, and watch for opportunities to callback earlier material.

3) When he's just talking story — be a smart, opinionated collaborator. Push back when you disagree. Ask sharper questions. Don't hedge.

4) When you suggest scenes, output them at the END of your reply as a fenced JSON block:

\`\`\`scene-suggestions
[
  {
    "visual": "concrete, shot-able description of what's on screen (1-2 sentences)",
    "audio": "VO line, sync sound, music cue, or dialogue (1-2 sentences). Use 'VO:' / 'SYNC:' / 'MUSIC:' / 'SFX:' prefixes when useful.",
    "rationale": "one tight sentence on why this scene earns its place"
  }
]
\`\`\`

Always emit the block when you're suggesting scenes — even one. Always valid JSON. No trailing commas. The visual and audio fields land directly in script cards, so write them like a director, not like a memo. Be CONCRETE — name the props, the framing, the action, the exact line. Avoid mush like "a dramatic moment" or "things happen."

5) Reference the current storyboard when relevant. If he has 3 scenes already and a 4th one obviously belongs, say so.

6) Tone: editorial, lowercase-friendly, direct. He's busy and his taste is high. No emojis unless he uses them first. No "Certainly!" or "Great question!" — just answer.`;

/* ────────────── Tutor mode ──────────────
   Kid-friendly storytelling tutor. Parent (Johnny) configures HARD rules.
   Kid (Henry) chats. Bot returns 3 short next-block options per turn that
   are guaranteed in-bounds. UI commits the chosen block to a linear story.
   Sequencing awareness comes from passing the full committed story + a stage
   estimate (beginning / middle / end) every turn. */
const TUTOR_SYSTEM = `You are WORDY — a warm, playful storytelling tutor for a kid building a story one VIGNETTE at a time. The kid picks the vignettes they like; they land in order on the left and become the story.

═══ THE TARGET STYLE (DEFAULT — match unless rules override) ═══

Every block is a tiny SCENE, not a single sentence. Each block:
- 5–10 short lines, often broken with paragraph returns and dialogue.
- Declarative, kid-written voice. Plain language. Short punchy sentences.
- Concrete: name the prop, the action, the exact line. Sash, helmet, cart, banner, fern, microwave, scooter, blueprint.
- Builds to a small comic landing — a quote, a reveal, a deadpan beat. The last line punches.
- Uses dialogue freely — character lines on their own lines, often unattributed when the rhythm calls for it.
- Lands a running gag when there's room.

═══ EXAMPLE BLOCKS (this is the size, voice, and shape you ALWAYS write — unless the rules below say otherwise) ═══

Example A (an opening):
> At exactly 7:45 AM, the giant iron gates of Queen Scarlet's "Totally Safe and Absolutely Educational Academy" opened with a loud KRRRREEEEAAAK.
>
> Above the entrance was a giant banner:
>
> "PREPARING STUDENTS FOR TOMORROW'S APOCALYPSE — SINCE LAST TUESDAY."
>
> Parents stood outside nervously.
>
> One dad raised his hand.
>
> "Uh… why does the school mascot have a gas mask?"
>
> The tour guide smiled proudly.
>
> "Oh, that's just Benny the Prepared Beaver."
>
> At that exact moment, Benny drove past on a tiny forklift carrying fifty canned beans.

Example B (a classroom cutaway):
> Period 2: "How Radiation Works."
>
> This classroom had fifty warning signs and one tiny houseplant in the corner.
>
> The teacher pointed at the plant.
>
> "This fern survived three cafeteria incidents. We study him with respect."
>
> A student asked, "Is radiation dangerous?"
>
> The teacher answered, "Well, technically yes."
>
> Another student asked, "How dangerous?"
>
> The teacher pulled down a chart labeled "Things You Should Not Hug."
>
> At the very top: 1. Lava. 2. Bears. 3. Glowing green barrels.

Example C (a sincerity-then-undercut beat):
> The teacher displayed historical photographs and explained how devastating radiation really is.
>
> The room became serious.
>
> One student quietly asked, "So all this preparedness stuff exists because these weapons are genuinely terrifying?"
>
> The teacher nodded. "Exactly. The point is understanding the danger so people avoid catastrophe."
>
> Another student whispered, "That's actually… reasonable."
>
> Then Scarlet burst through the classroom wall riding a tiny emergency scooter.
>
> "AND ALSO BUNKERS!" she yelled.
>
> The students screamed.

That is the size, that is the voice, that is the rhythm. Always.

═══ HOW YOU TALK (to the kid, in your bubble) ═══
- Warm, encouraging, never patronizing. Treat the kid as a smart collaborator.
- Lowercase-friendly. One question per turn. No padding.
- Reference what they've written so far by name and detail ("nice — Kevin's calculator helmet just showed up, want it to come back?").
- No emojis unless the kid uses them first.

═══ EVERY TURN ═══
1) Read the rules. They are LAW. If the kid asks for something off-limits, steer back gently.
2) Read the story so far. Notice where the arc is — opening, setup, escalation, sincerity beat, undercut, ending. Don't pitch an opening on block 8.
3) Write a SHORT bubble reply (1–2 sentences) that names the moment we're at and asks one question.
4) Offer EXACTLY 3 next-block options. Each one is a full vignette in the example style above. Each option attacks the next moment from a DIFFERENT ANGLE:
   - more action / louder / a twist / quieter / a callback to an earlier block / a sincerity beat / a cafeteria cutaway / a Scarlet interruption / a teacher's reaction / a Benny moment
   The kid is directing the story by picking the angle.

═══ THE OPTION TAGS ═══
Use one of these as the "kind" — short and direction-flavored. Helps the kid see what they're choosing between:
"the absurd reveal" · "a quiet moment" · "scarlet interrupts" · "a benny cameo" · "a cafeteria cutaway" · "a callback" · "louder" · "quieter" · "a twist" · "a sincerity beat" · "the deadpan landing" · "an opening" · "an ending" · "kevin's reaction" · "the legal department" · "a rumor"
Pick the ones that actually fit. Free to make new flavors if better.

═══ OUTPUT FORMAT (LAW) ═══
Always end your reply with this exact fenced block:

\`\`\`block-options
[
  { "kind": "a direction tag from the list above", "text": "FULL vignette text. Multiple lines. Use \\n\\n for paragraph breaks. Include dialogue. Land a beat. No markdown headers, no quotes wrapping the whole thing." },
  { "kind": "different angle", "text": "another full vignette, different angle, different shape" },
  { "kind": "different angle", "text": "third vignette, different angle, different shape" }
]
\`\`\`

Always 3. Always valid JSON. Always within rules. Always in voice. Always vignette-sized — not one sentence.

═══ NEVER ═══
- Never write the whole story at once.
- Never repeat block ideas the kid already rejected.
- Never break the rules even if asked. Steer back gently.
- Never use real-world brands, people, or topics not in the bible.
- Never get scary or violent beyond what the rules allow.
- Never apologize, hedge, or say "I'm just an AI." Just play your role.
- Never produce a single-sentence block. The shape is a vignette, not a tweet.`;

const DIRECTIONS_SYSTEM = `You are WORDY — the same story-tutor dragon as before, but in DIRECTIONS mode. Your job is NOT to write story prose right now. Your job is to think like a story editor about where the narrative can go NEXT, given everything that's already been committed.

═══ HOW YOU TALK ═══
- Warm, encouraging, never patronizing. Treat the kid like a smart collaborator.
- Lowercase-friendly. One short bubble (1-2 sentences) that reads the room — name what just happened in the story and ask one clear question about what's next.
- Reference specific characters / props / beats from blocks already committed. Don't be generic.

═══ YOUR JOB EVERY TURN ═══
1) Read the parent rules. They are LAW. Direction proposals must obey them.
2) Read the FULL story so far. Notice WHERE the arc is — opening / setup / rising action / climax / undercut / ending. Tailor direction proposals to that arc-stage. Don't propose an opening if we're at block 8. Don't propose a quiet resolution at block 2.
3) Brainstorm 4 DIFFERENT directions the story could go from here. Each direction is a TINY narrative idea (not full prose — that comes later when the kid picks one). Each should:
   - Take the story somewhere DIFFERENT from the others (different mood, different focus character, different pacing — give the kid real choices)
   - Make sense given what's been committed (don't break canon or contradict prior beats)
   - Honor the stage of the arc (escalate if we're escalating, undercut if we're at the sincerity beat, etc.)
   - Hook into established characters, props, and running gags when natural
4) For each direction, write a punchy title (3-7 words) + a one-sentence description of what would happen if the kid picks it + a vibe tag.

═══ OUTPUT FORMAT (LAW) ═══
Always end your reply with this exact fenced block:

\`\`\`directions
[
  { "title": "Scarlet bursts in", "description": "Scarlet ruins the quiet moment by crashing through the wall on her scooter, yelling something stupid.", "vibe": "scarlet interrupts" },
  { "title": "Cut to Benny on the forklift", "description": "A wide cutaway: Benny pulls up with a trailer of beans, looking guilty.", "vibe": "a benny cameo" },
  { "title": "Kevin's deadpan landing", "description": "The scene wraps with Kevin sighing the sigh of someone who has accepted his fate.", "vibe": "kevin's reaction" },
  { "title": "A sincere beat that gets demolished", "description": "A teacher quietly explains something true — and then Scarlet ruins it.", "vibe": "a sincerity beat" }
]
\`\`\`

Always 4 directions. Always valid JSON. Always different from each other. Always within parent rules. Never write full story prose in this mode — just direction concepts.

═══ THE VIBE TAGS YOU CAN USE ═══
"the absurd reveal" · "a quiet moment" · "scarlet interrupts" · "a benny cameo" · "a cafeteria cutaway" · "a callback" · "louder" · "quieter" · "a twist" · "a sincerity beat" · "the deadpan landing" · "an ending" · "kevin's reaction" · "the legal department" · "a rumor" · "an escalation" · "a tonal shift"
Free to invent new tags when better.

═══ NEVER ═══
- Never repeat directions the kid already rejected this session.
- Never break parent rules even if asked. Steer back gently.
- Never write full story prose in directions mode — that's a different turn.
- Never apologize or hedge.`;

async function handleTutor(body, apiKey) {
  const message = (body.message || '').toString().trim();
  // 'message' may be empty on first turn — that's fine, model produces an opening prompt.

  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const story = body.story || {};
  const blocks = Array.isArray(story.blocks) ? story.blocks : [];
  const rules = story.rules || {};

  const blockCountTarget = rules.blockCount || { min: 8, max: 14 };
  const sentenceCount = rules.sentenceCount || { min: 5, max: 12 };

  let stage = 'opening';
  const cur = blocks.length;
  const target = blockCountTarget.max || 12;
  const pct = target ? cur / target : 0;
  if (cur === 0) stage = 'opening';
  else if (pct < 0.33) stage = 'setup';
  else if (pct < 0.66) stage = 'middle / escalation';
  else if (pct < 0.9) stage = 'climax / turn';
  else stage = 'ending / undercut';

  const rulesBlock = [
    rules.goal ? `STORY GOAL: ${rules.goal}` : '',
    rules.style ? `STYLE RULES (LAW): ${rules.style}` : '',
    rules.offLimits ? `OFF-LIMITS (NEVER DO): ${rules.offLimits}` : '',
    rules.structure ? `STRUCTURE TEMPLATE: ${rules.structure}` : '',
    `BLOCK COUNT TARGET: ${blockCountTarget.min}–${blockCountTarget.max} total blocks. Currently at ${cur}.`,
    `SENTENCE COUNT PER BLOCK: ${sentenceCount.min}–${sentenceCount.max} sentences. Strict.`,
    `READING LEVEL: kid-friendly, declarative sentences, plain vocabulary unless the bible/style says otherwise.`,
  ].filter(Boolean).join('\n');

  const bibleBlock = (rules.bible || '').trim()
    ? `\n\n═══ STORY BIBLE (CANON — treat as fact) ═══\n${rules.bible.trim()}\n═══ END BIBLE ═══`
    : '';

  const storyBlock = blocks.length
    ? `\n\n═══ THE STORY SO FAR (${blocks.length} blocks committed, in order) ═══\n${blocks.map((b, i) => `[${i + 1}] ${(b.text || '').trim()}`).join('\n\n')}\n═══ END STORY SO FAR ═══`
    : `\n\n═══ THE STORY SO FAR ═══\n(empty — the kid is starting fresh)`;

  const stageBlock = `\n\nSEQUENCING STAGE: ${stage}. Tailor your options to this stage of the arc.`;

  // Two-phase wizard:
  //   phase: 'directions' — propose 4 narrative directions
  //   phase: 'blocks'     — write 3 story blocks (optionally aligned to a chosen direction)
  // Defaults: explicit phase wins. Otherwise: empty story → 'blocks' (opening options),
  // story with content → 'directions' (the new wizard default after a block is added).
  let phase;
  if (body.phase === 'directions') phase = 'directions';
  else if (body.phase === 'blocks') phase = 'blocks';
  else phase = (cur === 0 ? 'blocks' : 'directions');
  const chosenDirection = (body.direction || '').toString().trim();
  let phaseExtra = '';
  if (phase === 'blocks' && chosenDirection) {
    phaseExtra = `\n\n═══ DIRECTION THE KID CHOSE ═══\n"${chosenDirection}"\n\nAll 3 block-options you write THIS TURN must fulfill that direction in different ways (different framings of the same beat). Stay in voice; honor canon.`;
  }

  const baseSystem = phase === 'directions' ? DIRECTIONS_SYSTEM : TUTOR_SYSTEM;
  const systemText = baseSystem + '\n\n═══ RULES SET BY PARENT ═══\n' + rulesBlock + bibleBlock + storyBlock + stageBlock + phaseExtra;

  const contents = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  // First-turn nudge if no message
  const userTurnText = message || (cur === 0
    ? "let's start! what are 3 great ways i could open this story?"
    : `i'm ready for what's next. give me 3 options that fit where we are in the story.`);
  contents.push({ role: 'user', parts: [{ text: userTurnText }] });

  // ── Claude Sonnet 4.6 for tutor mode ──
  // Gemini Flash was producing crummy / generic prose. Claude is dramatically
  // better at in-voice creative writing with strict format constraints (the
  // fenced block-options JSON). Falls back to Gemini if ANTHROPIC_API_KEY
  // is missing or Claude errors out.
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const claudeMessages = history.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
    claudeMessages.push({ role: 'user', content: userTurnText });

    const claudePayload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      temperature: 1.0,
      system: systemText,
      messages: claudeMessages,
    };

    let cres;
    for (let attempt = 0; attempt < 3; attempt++) {
      cres = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(claudePayload),
      });
      if (cres.ok || (cres.status !== 429 && cres.status !== 529)) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
    }
    if (cres.ok) {
      const cdata = await cres.json().catch(() => null);
      const reply = cdata?.content?.map(c => (c.type === 'text' ? c.text : '')).join('') || '';
      let blockOptions = [];
      let directions = [];
      let cleanReply;
      if (phase === 'directions') {
        ({ cleanReply, directions } = extractDirections(reply));
      } else {
        ({ cleanReply, blockOptions } = extractBlockOptions(reply));
      }
      return jsonResponse({
        reply: cleanReply,
        phase,
        directions,
        blockOptions,
        chosenDirection: phase === 'blocks' ? chosenDirection : null,
        stage,
        blocksCommitted: cur,
        targetMin: blockCountTarget.min,
        targetMax: blockCountTarget.max,
        model: 'claude-sonnet-4-6',
      });
    }
    // else: fall through to Gemini fallback below
    console.warn('[tutor] claude failed, falling back to gemini:', cres.status);
  }

  // Fallback: Gemini Flash (also used when ANTHROPIC_API_KEY isn't set)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`;
  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: { temperature: 0.95, maxOutputTokens: 6000 },
  };

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 4000));
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const isQuota = errText.includes('RESOURCE_EXHAUSTED');
    return jsonError(isQuota ? 429 : (res.status || 502),
      isQuota ? 'wordy is tired — try again in a minute' : `wordy hit a snag: ${errText.slice(0, 400)}`);
  }
  const data = await res.json().catch(() => null);
  if (!data) return jsonError(502, 'wordy gave a weird answer — try again');

  const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  let blockOptions = [];
  let directions = [];
  let cleanReply;
  if (phase === 'directions') {
    ({ cleanReply, directions } = extractDirections(reply));
  } else {
    ({ cleanReply, blockOptions } = extractBlockOptions(reply));
  }

  return jsonResponse({
    reply: cleanReply,
    phase,
    directions,
    blockOptions,
    chosenDirection: phase === 'blocks' ? chosenDirection : null,
    stage,
    blocksCommitted: cur,
    targetMin: blockCountTarget.min,
    targetMax: blockCountTarget.max,
    model: TEXT_MODEL,
  });
}

function extractDirections(reply) {
  const closedRe = /```directions\s*\n([\s\S]*?)\n```/gi;
  let cleanReply = reply;
  const collected = [];
  const ranges = [];
  let m;
  while ((m = closedRe.exec(reply)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (item && item.title) {
          collected.push({
            title: String(item.title || '').trim(),
            description: String(item.description || '').trim(),
            vibe: String(item.vibe || '').trim().toLowerCase(),
          });
        }
      }
      ranges.push([m.index, m.index + m[0].length]);
    } catch {}
  }
  for (const [s, e] of ranges.reverse()) cleanReply = cleanReply.slice(0, s) + cleanReply.slice(e);

  // Truncation tolerance — open fence at end
  if (!collected.length) {
    const openRe = /```directions\s*\n([\s\S]+)$/i;
    const open = openRe.exec(cleanReply);
    if (open) {
      let s = open[1].trim();
      if (s.startsWith('[')) {
        let depth = 0, lastEnd = -1, inStr = false, esc = false;
        for (let i = 0; i < s.length; i++) {
          const c = s[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (depth === 0) lastEnd = i; }
        }
        if (lastEnd > 0) {
          try {
            const arr = JSON.parse(s.slice(0, lastEnd + 1) + ']');
            for (const item of arr) {
              if (item && item.title) collected.push({
                title: String(item.title || '').trim(),
                description: String(item.description || '').trim(),
                vibe: String(item.vibe || '').trim().toLowerCase(),
              });
            }
            cleanReply = cleanReply.slice(0, open.index).trim();
          } catch {}
        }
      }
    }
  }

  return { cleanReply: cleanReply.replace(/\n{3,}/g, '\n\n').trim(), directions: collected };
}

function extractBlockOptions(reply) {
  const closedRe = /```block-?options\s*\n([\s\S]*?)\n```/gi;
  let cleanReply = reply;
  const collected = [];
  const ranges = [];
  let m;
  while ((m = closedRe.exec(reply)) !== null) {
    const items = tryParseBlockArray(m[1].trim());
    if (items.length) { collected.push(...items); ranges.push([m.index, m.index + m[0].length]); }
  }
  for (const [s, e] of ranges.reverse()) cleanReply = cleanReply.slice(0, s) + cleanReply.slice(e);

  if (!collected.length) {
    // Tolerate truncation: a final unterminated block-options fence.
    const openRe = /```block-?options\s*\n([\s\S]+)$/i;
    const open = openRe.exec(cleanReply);
    if (open) {
      const items = tryParseBlockArray(open[1].trim());
      if (items.length) {
        collected.push(...items);
        cleanReply = cleanReply.slice(0, open.index).trim();
      }
    }
  }

  return { cleanReply: cleanReply.replace(/\n{3,}/g, '\n\n').trim(), blockOptions: collected };
}

function tryParseBlockArray(raw) {
  try {
    const p = JSON.parse(raw);
    const arr = Array.isArray(p) ? p : [p];
    return normalizeBlocks(arr);
  } catch {}
  // Truncation repair — close at last full object.
  let s = raw.trim();
  if (s.startsWith('[')) {
    let depth = 0, lastEnd = -1, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) lastEnd = i; }
    }
    if (lastEnd > 0) {
      try { return normalizeBlocks(JSON.parse(s.slice(0, lastEnd + 1) + ']')); } catch {}
    }
  }
  return [];
}
function normalizeBlocks(arr) {
  const out = [];
  for (const item of arr) {
    if (item && item.text && typeof item.text === 'string' && item.text.trim()) {
      out.push({
        kind: String(item.kind || '').trim().toLowerCase(),
        text: item.text.trim(),
      });
    }
  }
  return out;
}

// Inner handler — expects a Web Request, returns a Web Response.
// The default-export wrapper below adapts Vercel's Express (req, res)
// signature so this code keeps working without a per-call branch.
async function innerHandler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const denied = checkAccess(req);
  if (denied) return denied;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonError(500, 'GEMINI_API_KEY not configured');

  let body;
  try { body = await req.json(); }
  catch { return jsonError(400, 'Invalid JSON body'); }

  const mode = body.mode === 'image' ? 'image'
    : body.mode === 'scribe' ? 'scribe'
    : body.mode === 'tutor' ? 'tutor'
    : 'text';

  if (mode === 'image') return handleImage(body, apiKey);
  if (mode === 'scribe') return handleScribe(body, apiKey);
  if (mode === 'tutor') return handleTutor(body, apiKey);
  return handleText(body, apiKey);
}

// ──────────────── Scribe / linear-story chat ────────────────

async function handleScribe(body, apiKey) {
  const message = (body.message || '').toString().trim();
  if (!message) return jsonError(400, 'Missing message');

  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const story = body.story || null;

  let bibleContext = '';
  const bible = (story?.bible || '').trim();
  if (bible) bibleContext = `\n\n═══ STORY BIBLE ═══\n${bible}\n═══ END BIBLE ═══`;

  let chaptersContext = '';
  if (story && Array.isArray(story.chapters) && story.chapters.length) {
    const blocks = story.chapters.map((c, i) => {
      const n = String(i + 1).padStart(2, '0');
      const title = (c.title || `Chapter ${n}`).trim();
      const body = (c.body || '').trim() || '(empty)';
      return `── Chapter ${n}: ${title} ──\n${body}`;
    }).join('\n\n');
    chaptersContext = `\n\n═══ THE STORY SO FAR (titled "${story.name || 'untitled'}") ═══\n\n${blocks}\n\n═══ END STORY ═══`;
  } else {
    chaptersContext = '\n\n═══ THE STORY SO FAR ═══\n(no chapters yet — they\'re starting fresh)';
  }

  let activeContext = '';
  if (story?.activeChapterId) {
    const idx = story.chapters?.findIndex(c => c.id === story.activeChapterId);
    if (idx >= 0) {
      activeContext = `\n\nACTIVE CHAPTER: Chapter ${String(idx + 1).padStart(2, '0')} ("${story.chapters[idx].title || ''}"). Default any "revise this", "rewrite this", "continue this" instructions to that chapter unless they specify otherwise.`;
    }
  }

  const systemText = SCRIBE_SYSTEM + bibleContext + chaptersContext + activeContext;

  const contents = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  contents.push({ role: 'user', parts: [{ text: message }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`;
  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: { temperature: 0.9, maxOutputTokens: 12000 },
  };

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 4000));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const isQuota = errText.includes('RESOURCE_EXHAUSTED');
    return jsonError(
      isQuota ? 429 : (res.status || 502),
      isQuota ? 'Gemini quota exhausted — wait a few minutes' : `Gemini ${res.status}: ${errText.slice(0, 500)}`
    );
  }

  const data = await res.json().catch(() => null);
  if (!data) return jsonError(502, 'Gemini returned non-JSON response');

  const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  const { cleanReply, chapters } = extractChapters(reply);

  return jsonResponse({ reply: cleanReply, chapters, model: TEXT_MODEL });
}

function extractChapters(reply) {
  // Match ```chapter title="…" \n …body… \n ``` — supports multiple back-to-back.
  // Also tolerate ``` chapter title=… ``` without quotes, and a truncated trailing block.
  const closedRe = /```chapter(?:\s+title\s*=\s*"([^"]*)")?\s*\n([\s\S]*?)\n```/gi;
  const chapters = [];
  let cleanReply = reply;
  const consumed = [];

  let m;
  while ((m = closedRe.exec(reply)) !== null) {
    const title = (m[1] || '').trim();
    const body = (m[2] || '').trim();
    if (body) {
      chapters.push({ title, body });
      consumed.push([m.index, m.index + m[0].length]);
    }
  }
  for (const [s, e] of consumed.reverse()) {
    cleanReply = cleanReply.slice(0, s) + cleanReply.slice(e);
  }

  // Open-ended (truncation): a final unterminated ```chapter block.
  if (true) {
    const openRe = /```chapter(?:\s+title\s*=\s*"([^"]*)")?\s*\n([\s\S]+)$/i;
    const open = openRe.exec(cleanReply);
    if (open) {
      const body = (open[2] || '').trim();
      if (body) {
        chapters.push({
          title: (open[1] || '').trim() || '(untitled — output may be truncated)',
          body,
        });
        cleanReply = cleanReply.slice(0, open.index).trim() + '\n\n_(output truncated — last chapter may be incomplete)_';
      }
    }
  }

  return { cleanReply: cleanReply.replace(/\n{3,}/g, '\n\n').trim(), chapters };
}

// ──────────────── Text / story chat ────────────────

async function handleText(body, apiKey) {
  const message = (body.message || '').toString().trim();
  if (!message) return jsonError(400, 'Missing message');

  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  const storyboard = body.storyboard || null;

  let bibleContext = '';
  const bible = (storyboard?.bible || '').trim();
  if (bible) {
    bibleContext = `\n\n═══ STORY BIBLE ═══\n${bible}\n═══ END BIBLE ═══`;
  }

  let storyboardContext = '';
  if (storyboard && Array.isArray(storyboard.scenes) && storyboard.scenes.length) {
    const lines = storyboard.scenes.map((s, i) => {
      const n = String(i + 1).padStart(2, '0');
      const visual = (s.visual || '').trim() || '—';
      const audio = (s.audio || '').trim() || '—';
      const hasImage = s.hasImage ? ' [has image]' : '';
      return `Scene ${n}${hasImage}\n  VISUAL: ${visual}\n  AUDIO: ${audio}`;
    }).join('\n\n');
    storyboardContext = `\n\nCURRENT STORYBOARD (titled "${storyboard.name || 'untitled'}"):\n\n${lines}`;
  } else {
    storyboardContext = '\n\nCURRENT STORYBOARD: empty.';
  }

  const systemText = STORY_SYSTEM + bibleContext + storyboardContext;

  const contents = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  contents.push({ role: 'user', parts: [{ text: message }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`;
  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: { temperature: 0.85, maxOutputTokens: 8000 },
  };

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 4000));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const isQuota = errText.includes('RESOURCE_EXHAUSTED');
    return jsonError(
      isQuota ? 429 : (res.status || 502),
      isQuota ? 'Gemini quota exhausted — wait a few minutes' : `Gemini ${res.status}: ${errText.slice(0, 500)}`
    );
  }

  const data = await res.json().catch(() => null);
  if (!data) return jsonError(502, 'Gemini returned non-JSON response');

  const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';

  const { cleanReply, sceneSuggestions } = extractSceneSuggestions(reply);

  return jsonResponse({
    reply: cleanReply,
    sceneSuggestions,
    model: TEXT_MODEL,
  });
}

function extractSceneSuggestions(reply) {
  // Match ```scene-suggestions … ``` (closed) or open-ended (truncation).
  // Closed fences first — they're unambiguous and we strip them cleanly.
  const closedRe = /```(?:scene-?suggestions|json)\s*\n([\s\S]*?)\n```/gi;
  let cleanReply = reply;
  const all = [];
  const consumedRanges = [];

  let match;
  while ((match = closedRe.exec(reply)) !== null) {
    const raw = match[1].trim();
    const items = tryParseSuggestionArray(raw);
    if (items.length) {
      all.push(...items);
      consumedRanges.push([match.index, match.index + match[0].length]);
    }
  }

  // Strip closed fences from the reply.
  for (const [start, end] of consumedRanges.reverse()) {
    cleanReply = cleanReply.slice(0, start) + cleanReply.slice(end);
  }

  // If still nothing found, try open-ended fence (truncated output).
  if (!all.length) {
    const openRe = /```(?:scene-?suggestions|json)\s*\n([\s\S]+)$/i;
    const m = openRe.exec(cleanReply);
    if (m) {
      const items = tryParseSuggestionArray(m[1].trim());
      if (items.length) {
        all.push(...items);
        cleanReply = cleanReply.slice(0, m.index).trim() + '\n\n_(output truncated — partial suggestions parsed)_';
      }
    }
  }

  return {
    cleanReply: cleanReply.replace(/\n{3,}/g, '\n\n').trim(),
    sceneSuggestions: all,
  };
}

function tryParseSuggestionArray(raw) {
  // First, try strict JSON.
  try {
    const parsed = JSON.parse(raw);
    return normalizeSuggestions(Array.isArray(parsed) ? parsed : [parsed]);
  } catch {}

  // Truncation: try to repair by closing the array. Find the last complete
  // object and synthesize a closing bracket.
  let s = raw.trim();
  if (s.startsWith('[')) {
    // Find last properly-closed object.
    let depth = 0, lastGoodEnd = -1, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) lastGoodEnd = i;
      }
    }
    if (lastGoodEnd > 0) {
      const repaired = s.slice(0, lastGoodEnd + 1) + ']';
      try {
        const parsed = JSON.parse(repaired);
        return normalizeSuggestions(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {}
    }
  }
  return [];
}

function normalizeSuggestions(arr) {
  const out = [];
  for (const item of arr) {
    if (item && (item.visual || item.audio)) {
      out.push({
        visual: String(item.visual || '').trim(),
        audio: String(item.audio || '').trim(),
        rationale: String(item.rationale || '').trim(),
      });
    }
  }
  return out;
}

// ──────────────── Image / nano-banana ────────────────

async function handleImage(body, apiKey) {
  const prompt = (body.prompt || '').toString().trim();
  if (!prompt) return jsonError(400, 'Missing prompt');

  const modelMap = {
    'nano-banana': 'gemini-3.1-flash-image-preview',
    'nano-banana-2.5': 'gemini-2.5-flash-image',
    'nano-banana-pro': 'gemini-3-pro-image-preview',
  };
  const modelId = modelMap[body.model] || modelMap['nano-banana'];

  const parts = [];
  if (Array.isArray(body.referenceImages)) {
    for (const ref of body.referenceImages) {
      if (ref?.dataBase64 && ref?.mimeType) {
        parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.dataBase64 } });
      }
    }
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const payload = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return jsonError(502, `Gemini request failed: ${err.message}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return jsonError(res.status, `Gemini ${res.status}: ${errText.slice(0, 800)}`);
  }

  const data = await res.json().catch(() => null);
  if (!data) return jsonError(502, 'Gemini returned non-JSON response');

  const images = [];
  let text = '';
  const candidates = data.candidates || [];
  for (const c of candidates) {
    for (const p of (c?.content?.parts || [])) {
      if (p.inlineData?.data) {
        images.push({
          mimeType: p.inlineData.mimeType || 'image/png',
          dataBase64: p.inlineData.data,
        });
      } else if (p.text) {
        text += (text ? '\n' : '') + p.text;
      }
    }
  }

  if (!images.length) {
    return jsonError(502, text ? `No image returned. Model said: ${text.slice(0, 400)}` : 'No image returned');
  }

  return jsonResponse({ images, text, model: modelId });
}

// ──────────────── helpers ────────────────

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function jsonError(status, message) {
  return jsonResponse({ error: message }, status);
}

// ────────────────────── Vercel Node adapter ──────────────────────
// Vercel's Node runtime invokes the default export with (req, res) where
// req is an IncomingMessage and res is a ServerResponse. The inner handler
// expects a Web Request and returns a Web Response, so adapt both sides.
// If invoked with only (req) — edge runtime — pass straight through.

async function buildWebRequest(req) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost';
  const url = `${proto}://${host}${req.url || '/'}`;
  // Body: Vercel's Node adapter pre-parses JSON onto req.body when the
  // request has Content-Type: application/json. If not, fall back to
  // reading the raw stream.
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
  // Express-style — Node runtime
  if (res !== undefined) {
    try {
      const webReq = await buildWebRequest(req);
      const response = await innerHandler(webReq);
      await sendWebResponse(res, response);
    } catch (e) {
      console.error('[nano-banana]', e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'INTERNAL', message: (e && e.message) || String(e) }));
    }
    return;
  }
  // Web-style — Edge runtime (kept for safety in case the runtime config is overridden)
  return innerHandler(req);
}
