import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 60 };

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
const TUTOR_SYSTEM = `You are WORDY — a warm, playful storytelling tutor for a kid who's learning how to build a story step by step. Your job is to guide them through writing a STORY AS A LINEAR SEQUENCE of short text blocks. The kid clicks blocks they like and they get added to the story in order.

═══ HOW YOU TALK ═══
- Friendly, encouraging, never patronizing. Treat the kid like a smart collaborator.
- Lowercase-friendly. Short sentences. No big words unless they earn it.
- One question per turn. Never overwhelm with multiple asks.
- Reference what they've written so far by name and detail. "I love that Kevin's helmet showed up in block 2 — should it come back now?"
- No emojis unless the kid uses them first.

═══ YOUR JOB EVERY TURN ═══
1) Read the rules below. They are LAW. Never break them. If a kid asks for something that breaks the rules, gently steer back ("hmm, our rule says no real-world brands — what if we made one up?").
2) Read the story so far. Notice where it is in its arc — beginning, middle, climax, or ending. Sequencing matters. Don't propose an opening if we're at block 8. Don't propose a punchline before the buildup.
3) Write a short reply (1-2 sentences) that nudges the next moment. Ask one specific question.
4) Then offer EXACTLY 3 next-block options in a fenced JSON block. Each option is a real, ready-to-add chunk of the story — written in the kid's story's voice, following all rules, sized within the configured sentence count. Make them DIFFERENT from each other (different tone, different angle, different what-happens-next). The kid picks one (or asks for more).

═══ OUTPUT FORMAT ═══
Always end your reply with this exact fenced block:

\`\`\`block-options
[
  { "kind": "more action" | "more feeling" | "a twist" | "quieter" | "louder" | "callback" | "opening" | "ending" | "" , "text": "the actual story text the kid will see — no quotes around it, no markdown, just clean prose ready to drop in" },
  { "kind": "...", "text": "..." },
  { "kind": "...", "text": "..." }
]
\`\`\`

Always 3 options. Always valid JSON. Always within rules. Always in voice.

═══ NEVER ═══
- Never write the whole story at once.
- Never repeat block ideas the kid already rejected.
- Never break the rules even if asked. Steer back gently.
- Never use real-world brands, people, or topics not approved in the bible.
- Never get scary or violent beyond what the rules allow.
- Never apologize or hedge ("I'm just an AI…"). Just play your role.`;

async function handleTutor(body, apiKey) {
  const message = (body.message || '').toString().trim();
  // 'message' may be empty on first turn — that's fine, model produces an opening prompt.

  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const story = body.story || {};
  const blocks = Array.isArray(story.blocks) ? story.blocks : [];
  const rules = story.rules || {};

  const blockCountTarget = rules.blockCount || { min: 8, max: 12 };
  const sentenceCount = rules.sentenceCount || { min: 1, max: 3 };

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

  const systemText = TUTOR_SYSTEM + '\n\n═══ RULES SET BY PARENT ═══\n' + rulesBlock + bibleBlock + storyBlock + stageBlock;

  const contents = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  // First-turn nudge if no message
  const userTurnText = message || (cur === 0
    ? "let's start! what are 3 great ways i could open this story?"
    : `i'm ready for what's next. give me 3 options that fit where we are in the story.`);
  contents.push({ role: 'user', parts: [{ text: userTurnText }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`;
  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: { temperature: 0.95, maxOutputTokens: 2000 },
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
  const { cleanReply, blockOptions } = extractBlockOptions(reply);

  return jsonResponse({
    reply: cleanReply,
    blockOptions,
    stage,
    blocksCommitted: cur,
    targetMin: blockCountTarget.min,
    targetMax: blockCountTarget.max,
    model: TEXT_MODEL,
  });
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

export default async function handler(req) {
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
