// Surfaces named characters from a story BIBLE so the signal extractor
// (qss-signals → blockSignals → extractCharacters) recognizes them as known
// characters when they appear in the story text — feeding detectFixation's
// SAME_CHARACTER signal in the live QSS tutor (api/nano-banana.js handleTutor).
//
// This is the server-side single source of truth, mirroring the proven
// client copy in queen-scarlet-school/index.html (locked by
// queen-scarlet-school/lib/parse-bible-characters.test.mjs).
//
// STOP is GRAMMAR-ONLY: articles, pronouns, aux/modal verbs, conjunctions,
// prepositions, question/adverb words, plus the bible's own structural
// headings. We deliberately do NOT stop ordinary nouns (Sky, Sun, Dragon…) —
// a kid may genuinely name a character that. Grammar words are what must never
// leak: if "She"/"His" leaked, the server would treat the pronoun as a
// recurring character and fire a false fixation hint at the tutor.
const STOP = new Set([
  // bible structure / headings / time markers
  'The', 'This', 'That', 'These', 'Those', 'Period', 'Class', 'Lunch', 'Final',
  'Story', 'Bible', 'Rules', 'Setting', 'Tone', 'Goal', 'About', 'Welcome',
  'Inside', 'Outside', 'First', 'Second', 'Third', 'Day', 'Today', 'Tomorrow',
  'Yesterday', 'When', 'Then', 'Once', 'Next', 'Last', 'After', 'Before', 'Also',
  // pronouns
  'She', 'His', 'Her', 'Him', 'Hers', 'Its', 'You', 'Your', 'Our', 'Ours', 'They',
  'Them', 'Their', 'Who', 'Whom', 'Whose', 'What', 'Which',
  // aux / modal / common sentence-starting verbs
  'Was', 'Were', 'Are', 'Has', 'Had', 'Have', 'Did', 'Does', 'Can', 'Could',
  'Will', 'Would', 'Should', 'May', 'Might', 'Must', 'Let', 'Get', 'Got',
  // conjunctions / prepositions / adverbs / question words
  'And', 'But', 'Now', 'Why', 'How', 'For', 'Nor', 'Yet', 'Out', 'Off', 'All',
  'One', 'Two', 'Not', 'Yes', 'Per', 'Via', 'Into', 'Onto', 'From', 'With', 'Some',
  'Any', 'Each', 'Every', 'Here', 'There', 'Where', 'Just', 'Very', 'Even', 'Still',
  // bible heading SHOUTS (the server copy historically stopped these uppercase forms)
  'BIBLE', 'RULES', 'GOAL', 'STYLE', 'OFFLIMITS', 'STRUCTURE',
]);

function extractBibleCharacters(bible) {
  if (!bible || typeof bible !== 'string') return [];
  const out = new Set();
  // First token 3-30 chars. The old floor was 4-30
  // (/\b[A-Z][a-zA-Z]{3,29}\b/), which silently dropped EVERY 3-letter name —
  // Max, Sam, Leo, Ben, Mia, Zoe, Ada, Ivy — the single most common kid naming
  // pattern. Optional second token for two-word names ("Queen Scarlet").
  const re = /\b([A-Z][a-zA-Z]{2,29}(?:\s+[A-Z][a-zA-Z]{2,29})?)\b/g;
  let m;
  while ((m = re.exec(bible)) !== null) {
    const parts = m[1].split(' ');
    if (STOP.has(parts[0])) {
      // First word is a grammar word (sentence starter) — don't drop a real
      // name riding behind it ("Now Max ran" must still yield Max).
      if (parts[1] && !STOP.has(parts[1])) {
        out.add(parts[1]);
        if (out.size > 30) break;
      }
      continue;
    }
    out.add(m[1]);
    if (out.size > 30) break;  // hard cap
  }
  return [...out];
}

export { extractBibleCharacters, STOP };
