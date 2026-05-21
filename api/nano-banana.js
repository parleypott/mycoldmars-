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

  const mode = body.mode === 'image' ? 'image' : 'text';

  if (mode === 'image') return handleImage(body, apiKey);
  return handleText(body, apiKey);
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
