// Lightweight heuristic signal extractors. Run synchronously over text.
// No AI calls. These power both the observation-log enrichment (so reports
// are cheap reads) and the inline fixation hints we feed Wordy when he's
// proposing directions for Henry.

import { escapeRegExp } from './escape-regexp.js';

// Known QSS canon characters. Caller can pass extras (parsed from the
// bible) but these are the baseline always-detect set.
const CANON_CHARACTERS = [
  'Scarlet', 'Queen Scarlet',
  'Benny', 'Kevin',
  'Mark Rober',
  'Principal',
  'Legal Department',
];

// Action-verb category dictionaries. Detected via word-boundary regex.
// 'extreme' words are the ones we'd flag if they spike — escalation lexicon.
// 'quiet' words are the counter-signal — moments of restraint.
const CATEGORIES = {
  extreme: [
    'explode','exploded','exploding','explosion','explosions',
    'destroy','destroyed','destroying','destruction',
    'kill','killed','killing','murder','murdered',
    'crash','crashed','crashing','crashes',
    'burst','bursts','bursting',
    'shatter','shattered','smash','smashed',
    'launch','launched','launching',
    'detonate','detonated','detonation',
    'obliterate','obliterated',
    'nuke','nuked','nuclear',
    'attack','attacked','attacking',
    'fire','fired','firing',  // could be ambiguous but in QSS context usually means weapon
    'missile','missiles','bomb','bombs','bombed','bombing',
    'rampage','rampaged',
    'collapse','collapsed','collapsing',
    'annihilate','annihilated',
  ],
  loud: [
    'yelled','yelling','shouted','shouting','screaming','screamed',
    'booming','blared','blaring','crashing','roared','roaring',
  ],
  quiet: [
    'whispered','whispering','quietly','softly','muttered','mumbling',
    'sighed','sighing','nodded','paused','still','silence','silent',
    'glanced','stared','watched','listened','waited',
  ],
  comedic: [
    'tripped','slipped','tumbled','bonked','wobbled','spluttered',
    'snorted','giggled','chuckled','snickered','farted',
  ],
};

// Common settings/locations the QSS world cycles through. Map to a coarse
// "setting bucket" signal so we can detect "5 cafeteria scenes in a row".
const SETTINGS = {
  cafeteria:  /\b(cafeteria|lunch|lunchroom|dining hall|microwave)\b/i,
  classroom:  /\b(classroom|class\b|period \d|teacher|desk(s)?|blackboard|whiteboard)\b/i,
  hallway:    /\b(hallway|corridor|locker)\b/i,
  gym:        /\b(gym|gymnasium|locker room)\b/i,
  library:    /\b(library|book(s)?|shelves?)\b/i,
  office:     /\b(principal'?s office|office)\b/i,
  outdoors:   /\b(playground|field|outside|gate(s)?|parking lot|bus)\b/i,
  bunker:     /\b(bunker|underground|tunnel|cellar)\b/i,
  assembly:   /\b(assembly|auditorium|stage|gymnasium)\b/i,
  cafeteria_microwave: /\b(microwave)\b/i,  // sub-category for the running gag
};

function sentenceCount(text) {
  if (!text) return 0;
  const matches = text.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

function wordCount(text) {
  if (!text) return 0;
  return (text.match(/\S+/g) || []).length;
}

// escapeRegExp (used below to interpolate a vocabulary word — character name
// or category verb — LITERALLY into a `\b…\b` pattern; without it a word with a
// metachar like 'Dr. Periwinkle' or 'K.O.' either mis-matches or crashes the
// signal pass) lives in the shared ./escape-regexp.js, imported at the top so it
// can never drift from the qss-canon.js copy (obs 6441).

function extractCharacters(text, extras = []) {
  if (!text) return [];
  const out = new Set();
  const list = [...CANON_CHARACTERS, ...extras];
  for (const c of list) {
    // Match whole-word, case-sensitive for proper nouns.
    const re = new RegExp(`\\b${escapeRegExp(c)}\\b`);
    if (re.test(text)) out.add(c);
  }
  return [...out];
}

function categoryHits(text, cats = CATEGORIES) {
  if (!text) return {};
  const lc = text.toLowerCase();
  const out = {};
  for (const [cat, words] of Object.entries(cats)) {
    let count = 0;
    for (const w of words) {
      // escapeRegExp: this twin of extractCharacters used to interpolate the
      // raw word, so a future category lexeme with a metachar would crash the
      // whole signal pass. Now it matches literally, like its sibling.
      const re = new RegExp(`\\b${escapeRegExp(w)}\\b`, 'g');
      const m = lc.match(re);
      if (m) count += m.length;
    }
    if (count > 0) out[cat] = count;
  }
  return out;
}

function detectSettings(text) {
  if (!text) return [];
  const hits = [];
  for (const [name, re] of Object.entries(SETTINGS)) {
    if (re.test(text)) hits.push(name);
  }
  return hits;
}

// A crude escalation score. Counts extreme/loud verbs, normalized by
// word count. Higher = more extreme/violent. We use this both per-block
// and aggregated as a curve over time.
function escalationScore(text) {
  if (!text) return 0;
  const wc = wordCount(text);
  if (!wc) return 0;
  const cats = categoryHits(text);
  const extreme = (cats.extreme || 0) + (cats.loud || 0) * 0.5;
  return Math.round((extreme / wc) * 1000) / 10;  // per 100 words, 1dp
}

// "Signals" payload — the bundle we attach to a single block's observation
// so reports can do simple jsonb queries later.
function blockSignals(text, opts = {}) {
  return {
    sentences: sentenceCount(text),
    words: wordCount(text),
    characters: extractCharacters(text, opts.extraCharacters || []),
    settings: detectSettings(text),
    categories: categoryHits(text),
    escalation: escalationScore(text),
  };
}

// ───────────────────────────────────────────
// Fixation detector — runs over the recent committed blocks.
// Used inline by the tutor endpoint to seed Wordy's PATTERN NOTES
// section with hints about what to gently redirect.
// ───────────────────────────────────────────

const FIXATION_WINDOW = 5;  // look back at the last N blocks

function detectFixation(blocks, extraCharacters = []) {
  if (!Array.isArray(blocks) || blocks.length < 3) {
    return { fixating: false, signals: {}, hints: [] };
  }
  const recent = blocks.slice(-FIXATION_WINDOW);
  const perBlock = recent.map(b => blockSignals(b.text || '', { extraCharacters }));

  // Same primary character in a row
  const charStreaks = {};
  for (const s of perBlock) {
    for (const c of s.characters) charStreaks[c] = (charStreaks[c] || 0) + 1;
  }
  const dominantChar = Object.entries(charStreaks).sort((a, b) => b[1] - a[1])[0];
  const sameCharStreak = dominantChar ? dominantChar[1] : 0;

  // Setting fixation
  const settingStreaks = {};
  for (const s of perBlock) {
    for (const st of s.settings) settingStreaks[st] = (settingStreaks[st] || 0) + 1;
  }
  const dominantSetting = Object.entries(settingStreaks).sort((a, b) => b[1] - a[1])[0];
  const sameSettingStreak = dominantSetting ? dominantSetting[1] : 0;

  // Escalation trajectory — is the score actually climbing toward the end?
  // A run counts as escalation only if it is (a) non-decreasing for 3+
  // blocks AND (b) shows a NET increase end-over-start. A flat steady
  // state of violence (e.g. 5,5,5) is NOT escalation — it is holding
  // steady, and is already caught by EXTREME_DENSITY below. ESCALATION_RUN
  // means specifically "trending up." Without the net-increase check a
  // flat run falsely fired the "Henry is in a make-it-more-extreme loop"
  // hint when the story wasn't escalating at all.
  const escs = perBlock.map(s => s.escalation);
  // Length of the non-decreasing run ending at the most recent block.
  let endRun = 1;
  for (let i = escs.length - 1; i > 0; i--) {
    if (escs[i] >= escs[i - 1] && escs[i] > 0) endRun++;
    else break;
  }
  const runStartEsc = escs[escs.length - endRun];
  const lastEsc = escs[escs.length - 1];
  // Climbing = a long-enough run that actually rose across its span.
  const climbing = endRun >= 3 && lastEsc > runStartEsc;

  // Extreme-category density — % of recent blocks where 'extreme' fired
  const extremeBlocks = perBlock.filter(s => (s.categories.extreme || 0) > 0).length;
  const extremeDensity = recent.length ? extremeBlocks / recent.length : 0;

  const flags = [];
  if (sameCharStreak >= 4 && dominantChar) flags.push(`SAME_CHARACTER:${dominantChar[0]}:${sameCharStreak}`);
  if (sameSettingStreak >= 4 && dominantSetting) flags.push(`SAME_SETTING:${dominantSetting[0]}:${sameSettingStreak}`);
  if (climbing) flags.push(`ESCALATION_RUN:${endRun}`);
  if (extremeDensity >= 0.6 && recent.length >= 3) flags.push(`EXTREME_DENSITY:${Math.round(extremeDensity*100)}%`);

  // Build human-readable hints that go into the prompt
  const hints = [];
  if (dominantChar && sameCharStreak >= 4) {
    hints.push(`"${dominantChar[0]}" has been the focus character in the last ${sameCharStreak} blocks. Henry is fixating on this character — gently propose at least one direction where someone else takes the lead.`);
  }
  if (dominantSetting && sameSettingStreak >= 4) {
    hints.push(`The last ${sameSettingStreak} blocks are all set in "${dominantSetting[0]}". Henry is fixating on this location — propose at least one direction in a new setting.`);
  }
  if (climbing) {
    hints.push(`The escalation score has climbed across the last ${endRun} blocks. Henry is in a "make it more extreme" loop. Propose at least one direction that DEFUSES instead of escalates — a quiet moment, an unexpected callback, a tonal shift.`);
  }
  if (extremeDensity >= 0.6 && recent.length >= 3) {
    hints.push(`${Math.round(extremeDensity*100)}% of recent blocks contain explosions / destruction / yelling. Henry's voice is great when it's dark AND varied — propose at least one direction with a different texture (a quiet beat, a character revealing something, a sincerity-then-undercut, a tiny mundane joke).`);
  }

  return {
    fixating: flags.length >= 1,
    severe: flags.length >= 2,
    flags,
    hints,
    signals: {
      window: recent.length,
      dominantChar: dominantChar ? dominantChar[0] : null,
      sameCharStreak,
      dominantSetting: dominantSetting ? dominantSetting[0] : null,
      sameSettingStreak,
      escalations: escs,
      escalationRun: endRun,
      extremeDensity,
    },
  };
}

export {
  CANON_CHARACTERS,
  blockSignals,
  detectFixation,
  sentenceCount,
  wordCount,
  extractCharacters,
  categoryHits,
  detectSettings,
  escalationScore,
  escapeRegExp,
};
