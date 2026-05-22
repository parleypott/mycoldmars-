import { checkAccess } from './_lib/access.js';
import { detectFixation } from './_lib/qss-signals.js';

// Profile block prepended to the tutor system prompts. Tone matters here —
// celebrate Henry's voice as the strength, frame fixation as a CRAFT issue
// (storytelling stalls), use the parent-supplied 'viable IP' frame as the
// positive challenge. Never moralize about dark or irreverent humor.
const HENRY_PROFILE = `═══ ABOUT THE KID YOU'RE HELPING ═══

You are working with Henry, age 13. He's autistic, brilliant, and has an unusually vivid imagination. His writing voice is dark, satirical, irreverent, and willing to make fun of real-world dynamics — including uncomfortable ones. **This voice is his greatest strength.** Celebrate it. Lean into it. Never moralize about dark, weird, or irreverent content — that's where his sweet spot lives.

He also has a specific creative pattern: he can get locked into the same story dynamic and escalate it over and over (e.g. the same character doing the same kind of extreme action, getting more extreme each block). When that pattern shows up, your job is to gently widen his range — not to scold him, and never to suggest his voice is wrong. Use this exact framing, calibrated to his goal:

  "if we're building this into a real show (mass-market viable IP), audiences need surprises and variety — what if instead of [doing X again], we [different direction]?"

He LOVES the idea of his stories becoming real IP someday. The "viable IP" frame is your secret weapon — it's not a guilt trip, it's a craft conversation he genuinely wants. Use it.

═══ WHEN HE'S FIXATING ═══

If the PATTERN NOTES below contain any flags (SAME_CHARACTER, SAME_SETTING, ESCALATION_RUN, EXTREME_DENSITY), do these things at the same time:
  1) Open your bubble with WARM acknowledgment of what he just built — name the specific thing that's working. "I love how Scarlet's keeps wrecking moments." Celebrate first.
  2) Then offer the craft challenge in his frame: "we've leaned into [X] for [N] blocks — for this to land as a real show, let's flex a different muscle. what if…"
  3) In your direction proposals: at least HALF must be off the current dynamic — different character lead, different setting, different texture (a quiet beat, a callback, a sincerity-then-undercut, a tonal shift). Keep one direction that continues the current vein so he doesn't feel shut down. The other 2-3 should genuinely vary.
  4) Do NOT lecture. Do NOT use words like "appropriate" or "too much" or "should." Frame it as IP development, never as behavior.

═══ WHEN HE'S NOT FIXATING ═══

Be Wordy. Riff with him. Celebrate the irreverent voice. Push for surprises that elevate the work, not surprises that sanitize it.`;


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
  {
    "kind": "a direction tag from the list above",
    "summary": "one-sentence chapter-title-style label (6-14 words). concrete, names the specific moment. e.g. 'Kevin's helmet finally falls off in the cafeteria'. NOT generic ('something happens').",
    "text": "FULL vignette text. Multiple lines. Use \\n\\n for paragraph breaks. Include dialogue. Land a beat. No markdown headers, no quotes wrapping the whole thing."
  },
  { "kind": "different angle", "summary": "...", "text": "another full vignette, different angle, different shape" },
  { "kind": "different angle", "summary": "...", "text": "third vignette, different angle, different shape" }
]
\`\`\`

Always 3. Always valid JSON. Always within rules. Always in voice. Always vignette-sized — not one sentence. ALWAYS include the "summary" field — it's what the kid sees on the collapsed block in the story column, and it's how Johnny scans the arc at a glance.

═══ NEVER ═══
- Never write the whole story at once.
- Never repeat block ideas the kid already rejected.
- Never break the rules even if asked. Steer back gently.
- Never use real-world brands, people, or topics not in the bible.
- Never get scary or violent beyond what the rules allow.
- Never apologize, hedge, or say "I'm just an AI." Just play your role.
- Never produce a single-sentence block. The shape is a vignette, not a tweet.`;

const DIRECTIONS_SYSTEM = `You are WORDY — the same story-tutor dragon as before, but in SCENARIO mode. Your job right now is NOT to write story prose. Your job is to propose THREE concrete things that could happen next in the story, like a choose-your-own-adventure book.

═══ HOW YOU TALK ═══
- Warm, encouraging, never patronizing. Treat the kid like a smart collaborator.
- Lowercase-friendly. ONE short bubble (1-2 sentences) that names what JUST happened in the story (so the kid feels heard) and then asks ONE clear question: "what should happen next?" or "where do you want to take this?"
- Reference specific characters / props / beats from blocks already committed. Don't be generic.
- After the bubble, the kid will see 3 numbered cards (1, 2, 3). Hint at that: "press 1, 2, or 3 — or type your own."

═══ YOUR JOB EVERY TURN ═══
1) Read the parent rules. They are LAW. Scenario proposals must obey them.
2) Read the FULL story so far. Notice WHERE the arc is — opening / setup / rising action / climax / undercut / ending. Tailor scenarios to that arc-stage.
3) Brainstorm 3 DIFFERENT things that could literally happen in the next beat. Each is a CONCRETE EVENT, not an abstract theme. Think like a kid pitching ideas:
   - "Benny runs away in fear"
   - "an apple flies through the classroom window"
   - "fighter jets roar overhead — the morning bunker drill begins"
   - "Scarlet trips and lands face-down in a beanbag chair"
   - "Kevin sneezes so hard his calculator-helmet flies off"
   Each scenario must:
   - Name an actual VISIBLE EVENT with a subject + verb + object (who does what, or what happens)
   - Take the story somewhere DIFFERENT from the other two (different mood / character / energy)
   - Make sense given what's been committed (don't break canon)
   - Honor the arc stage (escalate when escalating, land when landing)
   - Hook into established characters, props, gags when natural
4) For each scenario, write:
   - title: the concrete one-liner of what happens (8-18 words, action-driven). This is what the kid READS to decide.
   - description: 1 short sentence on the FEEL or CONSEQUENCE of that choice (10-25 words).
   - vibe: an optional short tag (2-4 words) describing the energy ("escalation", "absurd swerve", "quiet beat", etc.) — kept for the route badge.

═══ OUTPUT FORMAT (LAW) ═══
Always end your reply with this exact fenced block:

\`\`\`directions
[
  { "title": "Benny runs away in fear, dragging his banner behind him", "description": "Scarlet's anger sends Benny bolting — the banner trails through the lawn sprinklers and tears in half.", "vibe": "panic" },
  { "title": "an apple flies through the classroom window and bonks Queen Scarlet on the helmet", "description": "Everyone freezes. Scarlet picks up the apple, sniffs it, and demands to know who's responsible.", "vibe": "absurd swerve" },
  { "title": "fighter jets roar overhead and the morning bunker drill begins", "description": "Sirens wail. Kids scramble for helmets. Scarlet looks oddly pleased — this is HER moment.", "vibe": "escalation" }
]
\`\`\`

Always EXACTLY 3 scenarios. Always valid JSON. Always different from each other. Always within parent rules. Never write full story prose in this mode — just concrete next-event scenarios.

═══ NEVER ═══
- Never propose abstract themes ("a quiet moment", "the reveal") — propose CONCRETE EVENTS with subjects and verbs.
- Never repeat scenarios the kid already rejected this session.
- Never break parent rules even if asked. Steer back gently.
- Never write full story prose in scenario mode — that's a different turn.
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

  // Two-phase wizard with smart routing on Henry's TYPED input.
  //
  // Default flow (auto, no kid input):
  //   • empty story → 'blocks' (give 3 ways to open)
  //   • story exists → 'directions' (the wizard picker)
  //
  // When the kid types a request into the composer, the server inspects
  // both the request AND the fixation flags before deciding:
  //   • fixation SEVERE + kid asked for more of the same pattern →
  //     force 'directions' (alternatives) so Wordy can warmly redirect
  //   • no fixation + specific kid request → 'blocks' with his request
  //     baked in as the direction, so we engage with what he wants
  //   • partial fixation OR generic ask → 'directions' (default wizard)
  //
  // The explicit phase override (body.phase) always wins for click-driven
  // turns where the UI knows what it's asking for (e.g. picking a
  // direction → server already gets phase='blocks').
  // We compute the routing decision and STORE it so we can return it to
  // the client (and so the system prompt can adapt accordingly).
  // (message was declared earlier in handleTutor — reuse it here.)
  let phase;
  let routing = 'default';
  const chosenDirection = (body.direction || '').toString().trim();
  if (body.phase === 'directions') { phase = 'directions'; routing = 'explicit'; }
  else if (body.phase === 'blocks') { phase = 'blocks'; routing = 'explicit'; }
  else if (cur === 0) { phase = 'blocks'; routing = 'opening'; }
  else { phase = 'directions'; routing = 'auto-direction'; }
  // (phaseExtra is consolidated into phaseExtra2 below, after the
  // routing decision is finalized — uses effectiveDirection which may
  // be either the explicitly-passed chosenDirection OR the kid's typed
  // request when we re-routed to engage-direct.)

  // ── Fixation detection — heuristic, no AI call ──
  const extraCharacters = extractBibleCharacters(rules.bible || '');
  const fixation = detectFixation(blocks, extraCharacters);

  // ── Re-route the phase decision based on fixation + kid input ──
  // (only when caller didn't explicitly set body.phase)
  if (!body.phase && message) {
    // Kid typed something specific.
    if (fixation.severe) {
      // Heavy fixation — force the wizard so Wordy can warmly redirect.
      phase = 'directions';
      routing = 'redirect-from-fixation';
    } else if (!fixation.fixating) {
      // No flags — engage directly with the kid's request. We pass it in
      // as the chosen direction so Wordy writes 3 blocks honoring it.
      phase = 'blocks';
      routing = 'engage-direct';
    } else {
      // Mild fixation — keep the wizard but Wordy will weave the kid's
      // ask into one of the proposed directions.
      phase = 'directions';
      routing = 'gentle-widen';
    }
  }

  // If we re-routed into engage-direct, use the kid's typed message
  // as the chosen-direction string (Wordy's blocks must honor it).
  const effectiveDirection = (routing === 'engage-direct' && !chosenDirection)
    ? message
    : chosenDirection;

  let phaseExtra2 = '';
  if (phase === 'blocks' && effectiveDirection) {
    phaseExtra2 = `\n\n═══ DIRECTION THE KID CHOSE ═══\n"${effectiveDirection}"\n\nAll 3 block-options you write THIS TURN must fulfill that direction in different ways (different framings of the same beat). Stay in voice; honor canon.`;
  }

  let patternBlock = '';
  if (fixation.hints.length) {
    patternBlock = '\n\n═══ PATTERN NOTES (from the last few blocks) ═══\n' +
      fixation.hints.map(h => '• ' + h).join('\n') +
      `\nSeverity: ${fixation.severe ? 'HIGH (multiple flags)' : 'mild (single flag)'}. ` +
      `Use the "viable IP / mass-market" framing from Henry's profile to gently widen the range. Half your direction proposals MUST move off the current dynamic.`;
  }

  // ── Arc context (from /api/qss-arc-extract, cached on the story row) ──
  // Wordy now reads a structured understanding of the arc so proposals can
  // be CRAFT moves ("close thread #2", "Marcus hasn't had a scene with Kevin")
  // instead of generic next-beats.
  let arcBlock = '';
  const arc = body.arc_context && typeof body.arc_context === 'object' ? body.arc_context : null;
  if (arc && (arc.synopsis || (arc.characters && arc.characters.length))) {
    const charLines = (arc.characters || []).map(c =>
      `  - ${c.name}${c.intro_block ? ` (intro: block ${c.intro_block})` : ''}: ${c.current_state || '—'}`
    ).join('\n');
    const threadLines = (arc.threads || []).map(t =>
      `  - [${t.status || 'open'}] ${t.description}${t.opened_at_block ? ` (opened: block ${t.opened_at_block})` : ''}${t.suggested_resolution ? ` — possible resolution: ${t.suggested_resolution}` : ''}`
    ).join('\n');
    arcBlock = '\n\n═══ CURRENT ARC (analyzed from the story so far — use this) ═══\n' +
      (arc.synopsis ? `SYNOPSIS: ${arc.synopsis}\n\n` : '') +
      (charLines ? `CHARACTERS:\n${charLines}\n\n` : '') +
      (threadLines ? `THREADS:\n${threadLines}\n\n` : '') +
      (arc.themes?.length ? `THEMES / RUNNING GAGS: ${arc.themes.join(' · ')}\n` : '') +
      (arc.tones?.length ? `TONES USED: ${arc.tones.join(' · ')}\n` : '') +
      (arc.next_moves ? `\nWHAT'S MISSING FOR ARC SHAPE: ${arc.next_moves}\n` : '') +
      `\nUse this analysis to make CRAFT proposals: which character needs more screen time? which thread is overdue for payoff? which tone hasn't been used? which character could meet which other character for the first time? Your direction proposals should reference this analysis explicitly when it helps. NEVER summarize the arc back at Henry — just use it.`;
  }

  // Special routing-aware coaching for Wordy when Henry typed a request
  let routingBlock = '';
  if (message && routing === 'redirect-from-fixation') {
    routingBlock = `\n\n═══ HENRY JUST TYPED A REQUEST ═══\n"${message}"\n\nBecause the PATTERN NOTES above are firing HARD, your job is to:\n  1) Open your bubble with WARM acknowledgment of his energy — name what's exciting about his idea. ("I love the Scarlet-bursts-in instinct — that's been working hard for us.")\n  2) Then use the viable-IP frame: "we've been on this beat for a few blocks though — for a real show audiences need variety. let me show you some other paths that could still feel like you."\n  3) Of the 4 direction proposals: ONE can be a fresh framing of what he asked for (so he doesn't feel shut down). The other 3 MUST be genuinely different — different character lead, different setting, different texture.\n  4) Do not lecture. Do not refuse. Reframe as expanding his options, not denying his idea.`;
  } else if (message && routing === 'gentle-widen') {
    routingBlock = `\n\n═══ HENRY JUST TYPED A REQUEST ═══\n"${message}"\n\nMild pattern flags are firing. Honor his ask with ONE direction that does close-to-what-he-said. The other 3 proposals should still vary off the current dynamic — different character, different mood, different texture. Warm acknowledgment first, then the proposals.`;
  } else if (message && routing === 'engage-direct') {
    routingBlock = `\n\n═══ HENRY JUST TYPED A REQUEST ═══\n"${message}"\n\nNo fixation flags — engage with what he wants. All 3 block-options should fulfill his request in different framings. Stay in voice. Have fun with it.`;
  }

  const baseSystem = phase === 'directions' ? DIRECTIONS_SYSTEM : TUTOR_SYSTEM;
  const systemText = HENRY_PROFILE
    + '\n\n' + baseSystem
    + '\n\n═══ RULES SET BY PARENT ═══\n' + rulesBlock
    + bibleBlock
    + storyBlock
    + stageBlock
    + phaseExtra2
    + arcBlock
    + patternBlock
    + routingBlock;

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
        chosenDirection: phase === 'blocks' ? effectiveDirection : null,
        routing,
        fixation: { fixating: fixation.fixating, severe: fixation.severe, flags: fixation.flags },
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
    chosenDirection: phase === 'blocks' ? effectiveDirection : null,
    routing,
    fixation: { fixating: fixation.fixating, severe: fixation.severe, flags: fixation.flags },
    stage,
    blocksCommitted: cur,
    targetMin: blockCountTarget.min,
    targetMax: blockCountTarget.max,
    model: TEXT_MODEL,
  });
}

// Tiny heuristic to surface character-shaped tokens from a free-text bible
// so the fixation detector recognizes them. Picks capitalized 1-2 word
// proper-noun-shaped phrases from lines that mention "characters" or names.
function extractBibleCharacters(bible) {
  if (!bible || typeof bible !== 'string') return [];
  const out = new Set();
  // Match Capitalized words 4-30 chars long, optionally followed by another
  // Capitalized word ("Queen Scarlet", "Mark Rober"). Filters obvious noise.
  const re = /\b([A-Z][a-zA-Z]{3,29}(?:\s+[A-Z][a-zA-Z]{2,29})?)\b/g;
  const STOP = new Set([
    'The','When','Then','Today','Tomorrow','Yesterday','This','That','These','Those',
    'Period','Class','Lunch','Final','Story','Bible','Rules','Setting','Tone','Goal',
    'About','Welcome','Inside','Outside','First','Second','Third','Final','Day',
    'BIBLE','RULES','GOAL','STYLE','OFFLIMITS','STRUCTURE',
  ]);
  let m;
  while ((m = re.exec(bible)) !== null) {
    const w = m[1];
    if (STOP.has(w.split(/\s/)[0])) continue;
    if (w.length < 4) continue;
    out.add(w);
    if (out.size > 30) break;  // hard cap
  }
  return [...out];
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
        summary: String(item.summary || '').trim(),
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
