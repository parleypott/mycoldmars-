// queen-scarlet-school: per-character "playing card" generator.
// Given a character {name, current_state, intro_block} and surrounding story
// context, returns:
//   - synopsis: jokey/absurdist 3-4 sentences (Claude Haiku 4.5)
//   - portrait image: dataBase64 from nano-banana (gemini flash image preview)
//   - portraitPrompt: the prompt used (debug)
//
// Body: {
//   character: { name, current_state, intro_block },
//   arc: { synopsis, characters[], themes[], tones[] } | null,
//   recentBlocks: [{ text }],  // for tone matching
//   rules: { goal, bible }     // optional
// }
//
// Response: { synopsis, image: { mime, dataBase64 }, portraitPrompt, ms, model }
//
// Notes
//  - Two upstream calls in parallel when possible (Claude + Gemini); the
//    portrait prompt is derived locally from the character's name + state so
//    we don't need to wait for the synopsis to start the image.
//  - Cached client-side per (story_id, character_name); regeneration is opt-in.
//  - Voice / tone matches the rest of the WRITING_DISCIPLINE preamble — no
//    AI-thesaurus tropes, no "weaving threads", no overproduction.

import { checkAccess as sharedCheckAccess } from './_lib/access.js';
import { canonForName, canonContextBlock } from './_lib/qss-canon.js';
import { canonOverlayForBody } from './_lib/qss-worlds.js';

// Edge runtime. We TRIED moving to Node with a server-side retry to
// dodge the 25s edge cap, but the combination produced consistent 60s
// timeouts in production (Vercel's hard ceiling). Reverted to a clean
// single-attempt Edge call. Client retry loop (cast/index.html:1274)
// retries the whole endpoint 3 times, which empirically gets us to
// ~99% success even with a 20% per-attempt timeout rate.
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SYNOPSIS_SYSTEM = `You write character cards for a 13-year-old's story-writing tool. The kid is autistic, brilliant, writes dark satirical absurdist stories about a magical school. You're writing the back of a trading-card-style playing card.

Voice: deadpan-absurd, sincere-then-undercut, specific. NEVER use these AI-essay tropes: "pulling threads", "tipping into", "the story needs", "delve", "unpack", "intricate", "in essence", "think of it as", "weave", "tapestry". Don't moralize. Don't summarize themes. Don't tell the reader what to feel.

What to write (3-4 short sentences, ~50-90 words total):
1. The single thing you'd say at a party to introduce this character — one specific detail, not a label
2. What they're doing in the story right now — a concrete action or position
3. One small absurd or sincere detail that makes them feel real — a habit, a fear, a possession, a misunderstanding
4. (optional) A one-liner of their voice or a thing they'd say

DON'T:
- start with "Meet [name]"
- end with anything that sounds like a tagline
- explain their arc
- repeat their name 5 times
- moralize about whether what they do is good

DO:
- match the dark satirical tone of the existing story
- treat the character like the kid wrote them — preserve absurd specifics
- name beans, calculators, helmets, paperwork, the specific real things in the story
- write the way Henry would describe his friend to another friend who hasn't read the story yet

Return ONLY the synopsis text. No JSON, no markup, no preamble.`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const t0 = Date.now();
  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  // NOTE: a whoAmI() Supabase-user check used to live here, blocking
  // anyone not signed into Supabase. QSS doesn't have user accounts —
  // clients pass through the gate password → x-access-code bootstrap.
  // The shared perimeter (checkAccess above) is the appropriate gate
  // for this app; requiring real Supabase auth broke every card.

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!anthropicKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });
  if (!geminiKey) return json(500, { error: 'GEMINI_API_KEY not configured' });

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const ch = body.character || {};
  const name = String(ch.name || '').trim();
  if (!name) return json(400, { error: 'character.name required' });
  const currentState = String(ch.current_state || '').trim();
  const introBlock = Number(ch.intro_block) || null;

  const arc = body.arc || {};
  const themes = Array.isArray(arc.themes) ? arc.themes : [];
  const tones = Array.isArray(arc.tones) ? arc.tones : [];
  const arcSynopsis = String(arc.synopsis || '').trim();
  const recentBlocks = Array.isArray(body.recentBlocks) ? body.recentBlocks.slice(-6) : [];
  const recentText = recentBlocks.map((b, i) => `[${i + 1}] ${(b.text || '').trim()}`).join('\n\n');

  // World canon — non-negotiable facts about this character if they're canonical.
  // E.g. Queen Scarlet IS a red dragon; the model doesn't get to make her a human.
  const subjectCanon = canonForName(name);
  const canonBlock = canonContextBlock([name]);

  // ── Revise-mode inputs ───────────────────────────────────────────────
  // The cast page lets Henry chat with each character to refine their look.
  // When revise=true the server skips re-writing the synopsis (it's the
  // authored bio — only Claude writes it once) and instead:
  //  - rewrites visual_notes from chat + existing notes (Claude Haiku)
  //  - generates a NEW portrait honoring the visual notes + existing
  //    primary as a referenceImage so the new draw looks like a sibling
  //    of the existing one with the requested changes.
  const isRevise = !!body.revise;
  // vibeShift = Henry hit 👎 on the current direction. Rewrite visual_notes
  // to propose a MEANINGFULLY different archetype, drop reference images so
  // Gemini doesn't anchor to the rejected aesthetic, and tell the image
  // model explicitly to shift visual direction.
  const vibeShift = !!body.vibe_shift;
  const incomingNotes = String(body.visual_notes || '').trim();
  const chatHistory = Array.isArray(body.chat) ? body.chat.slice(-12) : [];
  const newMessage = String(body.new_message || '').trim();
  const existingSynopsis = String(body.existing_synopsis || '').trim();
  // Validate reference images. SAME guards for primary_portrait AND
  // referenceImages: shape check, no URL fields (SSRF guard), base64 size
  // cap, mime allowlist. Previously primary_portrait bypassed all of
  // these — a client could ship arbitrary mimeType and unbounded base64.
  const MAX_REF_BYTES = 6 * 1024 * 1024;
  const MIME_ALLOWLIST = /^image\/(png|jpe?g|webp|gif)$/i;
  function safeRef(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.url || raw.uri || raw.fileUri || raw.src) return null; // SSRF guard
    const dataBase64 = typeof raw.dataBase64 === 'string' ? raw.dataBase64 : '';
    if (!dataBase64 || dataBase64.length > MAX_REF_BYTES * 1.4) return null;
    const mimeType = String(raw.mimeType || raw.mime || 'image/png');
    if (!MIME_ALLOWLIST.test(mimeType)) return null;
    return { mimeType, dataBase64 };
  }
  // In vibeShift mode we INTENTIONALLY discard the primary portrait and
  // loved style anchors — they're what's locking the vibe Henry rejected.
  const refPortrait = vibeShift ? null : safeRef(body.primary_portrait);
  // Loved portraits — Henry ♥'d these to mark them as "this is the
  // style I want, make more like this." Validate shape, cap at 3.
  const loved = (vibeShift || !Array.isArray(body.referenceImages))
    ? []
    : body.referenceImages;
  const lovedRefs = loved
    .map(safeRef)
    .filter(Boolean)
    .slice(-3);

  // Compose chat transcript for the model
  const chatTranscript = [
    ...chatHistory.map(m => `${(m.role === 'wordy' ? 'wordy' : 'henry')}: ${String(m.content || '').slice(0, 600)}`),
    newMessage ? `henry: ${newMessage}` : '',
  ].filter(Boolean).join('\n');

  // ── Build the user message for the synopsis / notes call ─────────────
  let claudeUser;
  if (vibeShift) {
    // Vibe-shift: Henry hit 👎 on the current direction. Rewrite the
    // visual notes to propose a MEANINGFULLY different archetype, not
    // a small tweak. Keep name + current_state intact; change everything
    // else about the look.
    claudeUser = [
      `Character: ${name}`,
      canonBlock ? canonBlock : '',
      existingSynopsis ? `Existing synopsis (keep as-is):\n${existingSynopsis}` : '',
      incomingNotes ? `Visual notes that henry just REJECTED (do NOT iterate on these — pivot):\n${incomingNotes}` : 'No prior notes.',
      currentState ? `What they do in the story (still true): ${currentState}` : '',
      chatTranscript ? `Recent chat (for tone, not for visual direction):\n${chatTranscript}` : '',
      '',
      `henry hit 👎 on the current visual direction. He wants a MEANINGFULLY DIFFERENT vibe — not a tweak. Pivot the character's aesthetic.`,
      '',
      `What to change (all of these): the defining absurd PROP, the body type / silhouette, the color palette emphasis, the mood/expression archetype, the visual genre (sci-fi vs. medieval vs. cowboy vs. office-worker vs. critter vs. robot vs. swamp-thing vs. ...). Surprise him. Lean weird. Lean specific.`,
      `What to keep: the name, the role/current_state in the story, and any non-negotiable WORLD CANON traits.`,
      '',
      `Two outputs, in two fenced blocks. NO preamble.`,
      ``,
      `<chat_reply>`,
      `One short sentence (10-22 words) naming the new direction in plain words — not generic ("trying something different") but specific ("going full bog-witch on this one" or "what if she was a tiny gym coach instead"). End on a period.`,
      `</chat_reply>`,
      ``,
      `<visual_notes>`,
      `Fresh visual notes — 2-4 short comma-separated phrases describing the NEW look. Meaningfully different from the rejected notes. One line, no prose, no bullets.`,
      `</visual_notes>`,
    ].filter(Boolean).join('\n');
  } else if (isRevise) {
    // Revise mode: update visual_notes + produce a short chat reply.
    claudeUser = [
      `Character: ${name}`,
      canonBlock ? canonBlock : '',
      existingSynopsis ? `Existing synopsis (keep as-is):\n${existingSynopsis}` : '',
      incomingNotes ? `Current visual notes (update these):\n${incomingNotes}` : 'No visual notes yet.',
      chatTranscript ? `Chat with henry (most recent at bottom):\n${chatTranscript}` : '',
      '',
      `Two outputs, in two fenced blocks. NO preamble.`,
      ``,
      `<chat_reply>`,
      `One short sentence (10-22 words) that ACKNOWLEDGES henry's latest change request in the voice of a friendly co-conspirator. Be specific to what he said. No "let's", no "I'll", no apologies. Just confirm what's about to be redrawn. End on a period.`,
      `</chat_reply>`,
      ``,
      `<visual_notes>`,
      `Updated visual notes — 2-4 short comma-separated phrases describing the character's look right now (incorporate henry's latest request into the existing notes). E.g.: "calculator helmet, blue button-down, slouched shoulders, perpetually resigned expression". No prose. No bullets. One line.`,
      `</visual_notes>`,
    ].filter(Boolean).join('\n');
  } else {
    // First-time generation: write the synopsis + initial visual notes.
    claudeUser = [
      `Character: ${name}`,
      canonBlock ? canonBlock : '',
      currentState ? `Where they are right now: ${currentState}` : '',
      introBlock ? `Introduced around block ${introBlock}.` : '',
      arcSynopsis ? `Story so far: ${arcSynopsis}` : '',
      themes.length ? `Themes in play: ${themes.join(', ')}.` : '',
      tones.length ? `Tone of the story: ${tones.join(', ')}.` : '',
      recentText ? `Most recent story blocks for voice/tone:\n${recentText}` : '',
      '',
      `Two outputs, in two fenced blocks. NO preamble.`,
      ``,
      `<synopsis>`,
      `Back-of-the-card synopsis. 3-4 short sentences. Match the voice of the story. If WORLD CANON is provided above, every detail in it is non-negotiably true.`,
      `</synopsis>`,
      ``,
      `<visual_notes>`,
      `Initial visual notes — 2-4 short comma-separated phrases describing the character's look. E.g.: "calculator helmet, blue button-down, slouched shoulders, perpetually resigned expression". No prose, no bullets, one line.`,
      `</visual_notes>`,
    ].filter(Boolean).join('\n');
  }

  // Image prompt — includes incoming visual_notes when present.
  // In vibeShift mode we drop visual_notes so Gemini doesn't anchor to
  // the rejected direction; the prompt's VIBE SHIFT block tells it to
  // invent a meaningfully different archetype.
  const portraitPrompt = buildPortraitPrompt({
    name, currentState, themes, tones, recentBlocks, subjectCanon,
    visualNotes: vibeShift ? '' : incomingNotes,
    isRevise,
    vibeShift,
    newMessage,
  });

  const worldOverlay = canonOverlayForBody(body);
  const claudePromise = callClaude(anthropicKey, claudeUser, worldOverlay);
  const imagePromise = callNanoBanana(geminiKey, portraitPrompt + worldOverlay, refPortrait, lovedRefs);

  const [claudeR, imgR] = await Promise.allSettled([claudePromise, imagePromise]);

  // Parse the dual-fenced response
  let synopsis = existingSynopsis;
  let chatReply = '';
  let visualNotesOut = incomingNotes;
  if (claudeR.status === 'fulfilled') {
    const raw = claudeR.value || '';
    const synM = /<synopsis>\s*([\s\S]*?)\s*<\/synopsis>/i.exec(raw);
    const notesM = /<visual_notes>\s*([\s\S]*?)\s*<\/visual_notes>/i.exec(raw);
    const replyM = /<chat_reply>\s*([\s\S]*?)\s*<\/chat_reply>/i.exec(raw);
    if (synM) synopsis = cleanSynopsis(synM[1]);
    if (notesM) visualNotesOut = cleanSynopsis(notesM[1]).replace(/\n+/g, ' ').slice(0, 400);
    if (replyM) chatReply = cleanSynopsis(replyM[1]);
    // Fallback: if the model returned only plain prose, treat the whole thing
    // as the synopsis (legacy mode).
    if (!isRevise && !synM && raw.trim()) synopsis = cleanSynopsis(raw);
  } else {
    if (!isRevise) synopsis = `(couldn't write the card right now — try regenerating)`;
    console.warn('[character-card] claude failed:', claudeR.reason);
  }

  if (imgR.status !== 'fulfilled') {
    // Soft-fail: still return the chat reply + updated notes if available so
    // the chat doesn't leave Henry hanging.
    return json(502, {
      error: 'portrait failed',
      detail: String(imgR.reason).slice(0, 400),
      synopsis,
      visual_notes: visualNotesOut,
      chat_reply: chatReply,
    });
  }

  return json(200, {
    synopsis,
    image: imgR.value,
    visual_notes: visualNotesOut,
    chat_reply: chatReply,
    portraitPrompt,
    model: { synopsis: 'claude-haiku-4-5', portrait: 'gemini-3.1-flash-image-preview' },
    ms: Date.now() - t0,
  });
}

function cleanSynopsis(s) {
  return String(s || '')
    .replace(/^\s*synopsis\s*:\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
}

function buildPortraitPrompt({ name, currentState, themes, tones, recentBlocks, subjectCanon, visualNotes = '', isRevise = false, vibeShift = false, newMessage = '' }) {
  // Style anchor — match the existing QSS sticker art (Kevin in calculator
  // helmet, Benny the beaver in a gas mask on a bean forklift, the cartoon
  // dragon). The art has to feel as wild and imaginative as Henry's brain —
  // never a generic kid sticker. Prop-driven, deadpan, weird, specific.
  const style = [
    'STYLE: Whimsical, weird, prop-driven sticker illustration. As imaginative as a brilliant 13-year-old\'s drawings of his own characters.',
    'EVERY character has at least ONE absurd, oversized, story-specific physical feature or prop — a calculator-helmet head, a forklift, a gas mask, a backpack the size of their torso, antennae, extra eyes, a clipboard fused to their hand, a tail, weird ears, a doorknob for a nose, a haircut shaped like a building. The prop or feature IS the character. If you draw a plain person with no defining absurd feature, you have failed.',
    'Thick, confident, uniform black ink outlines (consistent line weight).',
    'Flat saturated cel-shaded colors — no gradients, no painterly textures, no photographic detail, no realistic skin rendering.',
    'Palette: tomato red, butter yellow, teal, ochre, sky blue, mossy green, lavender, salmon pink, warm cream — saturated, warm, slightly off-kilter.',
    'Background: plain warm cream / off-white paper (#F4ECD8 ish). No scenery, no environment behind the character. Centered subject.',
    // Framing + expression + pose come from the SHOT VARIATION block above
    // — do not re-specify them here; that creates a composition lock.
    'Quality: clean enough to be a vinyl laptop sticker. Slightly dorky. Charmingly drawn, not slick. Drawn like Henry would draw it — confident, weird, unselfconscious.',
  ].join(' ');

  // Diversity law — never default to a generic white kid. Skin can be any
  // human shade (deep brown, warm brown, olive, tan, golden, freckled pale)
  // OR fully non-human (purple, green, yellow, blue, lavender, mossy,
  // rust-orange, etc.). White / pinkish-pale skin is the LAST option, not
  // the first. For minor/throwaway characters lean non-human or unusual.
  const diversity = [
    'CHARACTER APPEARANCE — DIVERSITY LAW (non-negotiable):',
    'NEVER default to white / pinkish-pale skin. NEVER default to a generic North-American-cartoon-boy look.',
    'For human characters, skin color rotates across the full spectrum: deep brown, warm brown, golden tan, olive, freckled cream — pick whichever fits the character\'s vibe, NOT whichever is "default". If forced to choose with no signal, lean darker, not lighter.',
    'Non-human options are equally valid and often better: lavender skin, mossy green skin, sunshine yellow skin, butter-yellow skin, dusty rose, slate blue, terracotta. A whimsical color choice is a feature, not a bug.',
    'Hair: any color from real-world ranges (black, brown, blonde, red, auburn, silver) OR weird-real (lilac, mint, electric orange, faded teal). Hair shapes can be sculptural — a triangle, a cube, a single tall curl, two perfect spheres.',
    'Bodies: any body type, any height, any proportions. Big heads on small bodies, tall and gangly, round and squat — variety per draw.',
    'Gender: read the story signal. If no signal, do NOT default to boy. Rotate.',
  ].join(' ');

  const refs = [
    'STYLE REFERENCES (match these exactly):',
    '(1) GOLD STANDARD — Kevin: a boy with a giant grey calculator-helmet swallowing his whole head, a tiny red screen reading "ERROR: 3000", a chunky button keypad across the chin, a bagel sandwich floating beside him, wearing a teal hoodie with a yellow K emblem and a blue backpack. The prop dwarfs the character. Three small "BEEP BEEP BEEP" lozenges hover near the helmet. Deadpan resigned expression behind the visor.',
    '(2) Benny the beaver in an orange safety vest and gas mask driving a yellow forklift loaded with green BEANS cans.',
    '(3) A red cartoon dragon with yellow horns and teal-and-orange wings.',
    'EVERY new character must hit the Kevin bar: at least one absurd prop or physical feature that makes the character impossible to mistake for anyone else, drawn with the same line weight, same flat-color treatment, same warm cream paper feel.',
  ].join(' ');

  const dontList = [
    'DO NOT use any of these: a generic smiling kid with no defining prop, a "stock cartoon boy" face, default-white skin unless the story explicitly requires it, vintage yearbook portraiture, painterly brushwork, watercolor texture, risograph off-register effects, photorealism, manga/anime conventions, fantasy book cover polish, glitter, sparkles, lens flare, decorative scrolls, ornate frames, gradient backgrounds, scenery, ambient props beyond what the character is holding/wearing, text, labels, name tags, signage, logos, captions, or written words of any kind anywhere in the image.',
    'DO NOT draw a normal-looking person. If the story doesn\'t hand you an absurd prop, INVENT ONE that fits — an oversized clipboard, weird ears, a hat made of paperwork, a single comically large boot, a permanent tilt to their head, a halo of bees, a tail. The character without the absurdity is a failure state.',
  ].join(' ');

  const recentSnippet = recentBlocks
    .map(b => (b.text || '').trim())
    .filter(Boolean)
    .slice(-3)
    .join(' ')
    .slice(0, 400);

  const traits = currentState ? `Where they are right now in the story: "${currentState}". Use that to pick props, clothing, and pose.` : '';
  const tone = tones.length ? `Story tone keywords (for facial expression / energy): ${tones.join(', ')}.` : '';
  const story = recentSnippet ? `Snippet of recent story for visual hooks (objects, items they\'re holding, situation): "${recentSnippet}".` : '';
  const themeLine = themes.length ? `Story themes (use only if they suggest a specific visual prop, not as mood): ${themes.join(', ')}.` : '';

  // Canonical override — for established characters like Queen Scarlet,
  // these traits are non-negotiable and must dominate the user's bible /
  // story context if they conflict.
  const canonBlock = subjectCanon ? [
    `CANONICAL SUBJECT (non-negotiable — these traits OVERRIDE any contradicting story context):`,
    subjectCanon.species ? `- species: ${subjectCanon.species}` : '',
    subjectCanon.look    ? `- look: ${subjectCanon.look}` : '',
    subjectCanon.role    ? `- role: ${subjectCanon.role}` : '',
    subjectCanon.donts   ? `- must NOT draw: ${subjectCanon.donts}` : '',
  ].filter(Boolean).join('\n') : '';

  // Visual notes Henry has built up across redraws. These are the single
  // most important input — they're what makes Kevin LOOK like Kevin every
  // time. Put them HIGH in the prompt and emphasize they're authored.
  const notesBlock = visualNotes
    ? `AUTHORED VISUAL TRAITS (Henry has been refining these — they win over canon and over story context if anything conflicts, except for species/role canon which is still non-negotiable):\n${visualNotes}`
    : '';

  // For revise calls, surface the latest change request explicitly so the
  // image model knows what's DIFFERENT this time. The reference image
  // passed alongside establishes character continuity; this string tells
  // the model what to ALTER in that reference.
  // SKIP in vibeShift mode — we WANT to break continuity in that flow.
  const reviseBlock = vibeShift ? '' : (isRevise && newMessage
    ? `THIS DRAW IS A REVISION of an earlier portrait of the same character. The reference image attached shows the previous look. Keep the character recognizable as the same individual, but APPLY THIS SPECIFIC CHANGE: "${newMessage}". Don't redraw from scratch — adjust.`
    : (isRevise
        ? 'THIS DRAW IS A REVISION. Reference image attached. Keep the character recognizably the same individual; only tighten or align with the AUTHORED VISUAL TRAITS block above.'
        : ''));

  // Vibe-shift directive — fires when Henry hit 👎 on the previous look.
  // No reference image is attached this time (the caller dropped it).
  // Tell Gemini to invent a meaningfully different archetype across
  // every axis: prop, body, palette, mood, genre.
  const vibeShiftBlock = vibeShift ? [
    'VIBE SHIFT DIRECTIVE (HIGHEST PRIORITY — overrides everything below about matching previous portraits):',
    'Henry rejected the previous visual direction for this character. NO reference image is attached on purpose. Pick a FUNDAMENTALLY DIFFERENT visual archetype this time across ALL FOUR axes:',
    '1. DEFINING ABSURD PROP — invent a different one. If the last had a microphone-and-clipboard, give them a fishbowl helmet OR a bandolier of crayons OR a comically tall hat OR a single oversized boot OR a chest-mounted toaster OR a backpack of antennas. Specific and weird.',
    '2. BODY TYPE / SPECIES — humanoid → tiny squat critter → tall gangly humanoid → beaver/raccoon → sentient lamp → swamp-thing → robot → cat-headed humanoid → blob with a face → something stranger. Rotate.',
    '3. COLOR PALETTE emphasis — if previous leaned tomato-red-and-butter-yellow, lean mossy green and ochre, OR slate blue and salmon, OR pure lavender, OR deep terracotta. Single dominant palette per portrait.',
    '4. MOOD / ENERGY archetype — anxious bureaucrat | delusional optimist | exhausted parent | swaggering tyrant | sleepy mystic | nervous wreck | smug coward | overworked janitor | feral guard | bored saint. Pick one. Be specific to it.',
    'KEEP: the character\'s name, the role/current_state they have in the story, and any WORLD CANON non-negotiables.',
    'CHANGE: everything else about the look. Surprise the viewer. The result must read as a fundamentally different character VARIANT, not a re-pose of the previous one.',
  ].join(' ') : '';

  // ────────────────────────────────────────────────────────────────────
  // Shot variation — picked randomly per call.
  //
  // Problem: when a reference image is passed (revise mode or loved
  // refs), Gemini anchors composition too hard — every redraw of Queen
  // Scarlet was the same 3/4 view holding the same microphone in the
  // same pose. Identity-lock is good; composition-lock is not.
  //
  // Fix: explicitly tell the model which axes to KEEP from reference
  // (face, skin, hair, defining props, clothing colors) and which axes
  // to CHANGE this time (framing, pose, expression, angle, energy).
  // Pick one variant from each pool randomly per call so successive
  // redraws genuinely look like different shots of the same character.
  // ────────────────────────────────────────────────────────────────────
  const FRAMING_VARIANTS = [
    'tight head-and-shoulders bust, prop or feature fills the upper third of the frame',
    '3/4 body, mid-action, prop interacting with the character',
    'full-body sticker, head-to-toe with feet visible, slightly small in frame',
    'low-angle hero shot from below, character looming overhead',
    'high-angle, looking down at the character, who tilts head up to viewer',
    'side profile, head turned about 3/4 toward camera',
    'over-the-shoulder turn, looking back at viewer with partial face visible',
    'extreme close-up on the face, prop visible at frame edge',
    'pulled-back full sticker, character small against the cream paper',
    'medium shot, hands and prop in frame, eyes meeting viewer dead-on',
  ];
  const POSE_VARIANTS = [
    'caught mid-stride, one foot lifted',
    'frozen mid-task, prop being used',
    'seated and slouched, prop loose in lap',
    'leaning forward into the frame, elbows out',
    'arms crossed, weight on one hip',
    'mid-gesture, one hand raised in explanation',
    'turned away mid-shrug, half-looking back',
    'crouching to inspect something offscreen',
    'standing tall and rigid, formal-portrait stiff',
    'mid-jump, both feet off the ground',
    'kneeling on one knee, prop on raised knee',
    'mid-fall or just-tripped, off-balance',
  ];
  const EXPRESSION_VARIANTS = [
    'deadpan resigned, eyes half-lidded',
    'mid-eye-roll, exasperated',
    'mid-yawn, mouth wide, eyes squeezed shut',
    'distracted, looking past the camera',
    'wide-eyed surprised, eyebrows up',
    'smug smirk, head tilted',
    'exhausted, dark under-eye shadows, slumping',
    'intensely focused on something off-frame',
    'mid-shrug, palms up, mouth in flat line',
    'tongue stuck out in concentration',
    'mid-sentence, mouth open speaking',
    'just realized something, brow furrowed',
    'caught laughing at a private joke, mouth half-open',
  ];
  const ENERGY_VARIANTS = [
    'about to do the thing they are known for',
    'just finished doing the thing they are known for',
    'mid-way through a sentence',
    'reacting to an offscreen sound or event',
    'unaware of being observed, lost in their own world',
    'fully aware of the viewer, addressing them directly',
    'pretending nothing is wrong while something obviously is',
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  const framing = pick(FRAMING_VARIANTS);
  const pose = pick(POSE_VARIANTS);
  const expression = pick(EXPRESSION_VARIANTS);
  const energy = pick(ENERGY_VARIANTS);

  const variationBlock = [
    'SHOT VARIATION (THIS REDRAW MUST USE THESE — do not copy the composition of the reference image):',
    `- Framing: ${framing}.`,
    `- Pose: ${pose}.`,
    `- Expression: ${expression}.`,
    `- Energy: ${energy}.`,
    'IDENTITY-LOCK vs COMPOSITION-CHANGE: From the reference image and AUTHORED VISUAL TRAITS, INHERIT — face structure, skin color, eye color, hair shape and color, defining absurd prop, clothing colors and silhouette. CHANGE — body angle, framing distance, gesture, expression, energy. The result should read as the SAME CHARACTER caught at a DIFFERENT MOMENT, not a near-duplicate of the previous portrait.',
  ].join('\n');

  return [
    `SUBJECT: A character named ${name}. Render exactly ONE character — no extras, no crowd, no audience, no shadowy figures in the background.`,
    canonBlock,
    vibeShiftBlock,           // highest-priority pivot directive (only set when vibe-shifting)
    notesBlock,               // visualNotes is blanked in vibeShift mode, so this is empty then
    reviseBlock,              // also blanked in vibeShift mode
    variationBlock,
    traits,
    story,
    tone,
    themeLine,
    style,
    diversity,
    refs,
    dontList,
    'OUTPUT: A single sticker-style character illustration on a warm cream background. Approximately 2:3 portrait aspect ratio. Character centered. The character must be visually impossible to mistake for a generic cartoon kid — a defining absurd prop or non-default appearance is mandatory.',
  ].filter(Boolean).join('\n\n');
}

async function callClaude(apiKey, userMessage, worldOverlay = '') {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: SYNOPSIS_SYSTEM + worldOverlay,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.content?.map(c => (c.type === 'text' ? c.text : '')).join('') || '';
}

async function callNanoBanana(apiKey, prompt, refImage = null, lovedRefs = []) {
  // gemini-2.5-flash-image: ~8-15s, comfortably under Vercel's 25s Edge cap.
  // (gemini-3.1-flash-image-preview is higher quality but routinely 25-40s,
  // which would 504 the function.)
  const modelId = 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  // Reference images go BEFORE the text so Gemini anchors the new
  // portrait to them. Order: loved style anchors first (Henry's
  // approved style direction), then the most recent primary portrait
  // as the "this is the same character" anchor. Text prompt last.
  const parts = [];
  for (const ref of (lovedRefs || [])) {
    if (ref?.dataBase64 && ref?.mimeType) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.dataBase64 } });
    }
  }
  if (refImage && refImage.dataBase64) {
    parts.push({
      inlineData: {
        mimeType: refImage.mimeType || 'image/png',
        data: refImage.dataBase64,
      },
    });
  }
  parts.push({ text: prompt });
  const payload = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };

  // SINGLE attempt. On Edge runtime with Hobby's 25s cap we can't safely
  // retry server-side. The client retry loop in cast/index.html handles
  // transient failures with 3 attempts + backoff.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`gemini ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const candidates = data?.candidates || [];
  for (const c of candidates) {
    for (const p of (c?.content?.parts || [])) {
      if (p.inlineData?.data) {
        return {
          mime: p.inlineData.mimeType || 'image/png',
          dataBase64: p.inlineData.data,
        };
      }
    }
  }
  throw new Error('no image returned');
}

// access guard — delegates to the shared perimeter check at the top
// of this file. The previous local implementation accepted ANY
// `Authorization: Bearer ...` string, which meant `curl -H
// 'Authorization: Bearer x'` could call this endpoint and burn Haiku
// + Gemini image-gen credits with no rate limit.
function checkAccess(req) {
  return sharedCheckAccess(req);
}

// Verify the Bearer JWT resolves to a real user in OUR Supabase
// project (not just any project — same threat model as admin-users.js
// whoAmI). Returns the user payload or null.
async function whoAmI(req) {
  const auth = (typeof req.headers.get === 'function')
    ? (req.headers.get('authorization') || '')
    : (req.headers.authorization || req.headers.Authorization || '');
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaUrl || !anon) return null;
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${m[1]}`, apikey: anon },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
