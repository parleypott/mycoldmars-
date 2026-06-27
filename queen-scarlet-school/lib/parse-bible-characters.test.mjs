// Pins parseBibleCharacters — the client helper that surfaces named characters
// from a story's BIBLE so the server signal extractor recognizes them.
//
// THE CHAIN (why this matters): queen-scarlet-school/index.html calls
// parseBibleCharacters(bible) → ships the result as context.bibleCharacters to
// /api/qss-observe → blockSignals(text, { extraCharacters }) →
// extractCharacters(text, [...CANON, ...extras]). A name the client fails to
// surface is a name the server can't recognize in the story text, so the
// tutor's SAME_CHARACTER fixation signal never fires for it.
//
// THE BUG: the old regex floor was /[A-Z][a-zA-Z]{3,29}/ — first token 4-30
// chars — which silently dropped EVERY 3-letter name (Max, Sam, Leo, Ben, Mia,
// Zoe), the single most common kid-naming pattern. Lowering the floor to 3
// letters also means grammar words (She, His, And, Now…) must be stopped or
// they'd leak as false characters (a pronoun firing a fixation hint at a kid's
// tutor — the exact bug class fixed in qss-signals.js). The salvage branch also
// recovers a real name hiding behind a sentence-starter ("Now Max ran" → Max).
//
// parseBibleCharacters below is BYTE-IDENTICAL to the function shipped in
// queen-scarlet-school/index.html — same pure-JS source — so this exercises the
// real logic and goes RED if the floor or the grammar stoplist regresses.
//
// run: node queen-scarlet-school/lib/parse-bible-characters.test.mjs  (or: bun run test)

// ---- shipped function (keep identical to queen-scarlet-school/index.html) ----
function parseBibleCharacters(bible) {
  const STOP = new Set([
    // bible structure / headings / time markers
    'The','This','That','These','Those','Period','Class','Lunch','Final',
    'Story','Bible','Rules','Setting','Tone','Goal','About','Welcome',
    'Inside','Outside','First','Second','Third','Day','Today','Tomorrow',
    'Yesterday','When','Then','Once','Next','Last','After','Before','Also',
    // pronouns
    'She','His','Her','Him','Hers','Its','You','Your','Our','Ours','They',
    'Them','Their','Who','Whom','Whose','What','Which',
    // aux / modal / common sentence-starting verbs
    'Was','Were','Are','Has','Had','Have','Did','Does','Can','Could',
    'Will','Would','Should','May','Might','Must','Let','Get','Got',
    // conjunctions / prepositions / adverbs / question words
    'And','But','Now','Why','How','For','Nor','Yet','Out','Off','All',
    'One','Two','Not','Yes','Per','Via','Into','Onto','From','With','Some',
    'Any','Each','Every','Here','There','Where','Just','Very','Even','Still',
    // bible heading SHOUTS (uppercase forms — match the server copy so an
    // all-caps heading never leaks as a fake character into the tutor)
    'BIBLE','RULES','GOAL','STYLE','OFFLIMITS','STRUCTURE',
  ]);
  const out = new Set();
  const re = /\b([A-Z][a-zA-Z]{2,29}(?:\s+[A-Z][a-zA-Z]{2,29})?)\b/g;
  let m;
  while ((m = re.exec(bible || '')) !== null) {
    const parts = m[1].split(' ');
    if (STOP.has(parts[0])) {
      if (parts[1] && !STOP.has(parts[1])) { out.add(parts[1]); if (out.size > 30) break; }
      continue;
    }
    out.add(m[1]); if (out.size > 30) break;
  }
  return [...out];
}

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };
const has = (arr, x) => arr.includes(x);

// ---------- THE HEADLINE: 3-letter names are caught (were dropped) ----------
ok('Max is found',  has(parseBibleCharacters('Max is a curious dragon.'), 'Max'));
ok('Sam is found',  has(parseBibleCharacters('Sam built a machine.'), 'Sam'));
ok('Leo is found',  has(parseBibleCharacters('Leo runs fast.'), 'Leo'));
ok('Ben is found',  has(parseBibleCharacters('Ben is brave.'), 'Ben'));
ok('Mia is found',  has(parseBibleCharacters('Mia paints.'), 'Mia'));
ok('Zoe is found',  has(parseBibleCharacters('Zoe sings.'), 'Zoe'));
ok('Ivy is found',  has(parseBibleCharacters('Ivy is shy.'), 'Ivy'));
ok('Ada is found',  has(parseBibleCharacters('Ada codes.'), 'Ada'));

// ---------- 4+ letter names still work (no regression) ----------
ok('Maxwell found',  has(parseBibleCharacters('Maxwell is the hero.'), 'Maxwell'));
ok('Scarlet found',  has(parseBibleCharacters('Scarlet is a dragon.'), 'Scarlet'));
ok('two-word name',  has(parseBibleCharacters('Mark Rober visits.'), 'Mark Rober'));

// ---------- THE GUARD: grammar words must NEVER leak as characters ----------
// (the danger direction — a pronoun/article surfaced here becomes a false
//  recurring "character" server-side and fires a bogus fixation hint.)
const grammar = parseBibleCharacters(
  'She went there. His plan was big. And then they ran. But now what? ' +
  'The class is here. Why did you go? How are they? Was it the one?'
);
for (const w of ['She','His','And','But','Now','The','Why','How','Was','You',
                 'They','What','Here','There','One','Did','Are','This']) {
  ok(`grammar word "${w}" excluded`, !has(grammar, w));
}

// ---------- SALVAGE: a real name hiding behind a sentence-starter ----------
ok('"Now Max ran" yields Max',        has(parseBibleCharacters('Now Max ran.'), 'Max'));
ok('"Now Max ran" does NOT yield Now', !has(parseBibleCharacters('Now Max ran.'), 'Now'));
ok('"And Leo waited" yields Leo',     has(parseBibleCharacters('And Leo waited.'), 'Leo'));
ok('"Today Maxwell woke" yields Maxwell', has(parseBibleCharacters('Today Maxwell woke up.'), 'Maxwell'));
ok('"Today Maxwell" drops Today',     !has(parseBibleCharacters('Today Maxwell woke up.'), 'Today'));

// ---------- THE GUARD: all-caps bible heading SHOUTS must NEVER leak --------
// (the danger direction — a bible written with uppercase headings would
//  otherwise surface BIBLE/RULES/GOAL/STYLE/STRUCTURE as fake characters and
//  fire bogus fixation hints. Must match the server copy in api/_lib.)
const shouts = parseBibleCharacters(
  'BIBLE rules go here. RULES are simple. The GOAL is fun. ' +
  'STYLE matters. STRUCTURE helps. Max is the hero.'
);
for (const w of ['BIBLE','RULES','GOAL','STYLE','STRUCTURE']) {
  ok(`heading shout "${w}" excluded`, !has(shouts, w));
}
ok('real name survives among shouts (Max)', has(shouts, 'Max'));

// ---------- ordinary nouns are kept (kids name characters anything) ----------
ok('Sky kept (could be a name)',  has(parseBibleCharacters('Sky is a robot.'), 'Sky'));
ok('Sun kept (could be a name)',  has(parseBibleCharacters('Sun the cat purrs.'), 'Sun'));

// ---------- structure / edges ----------
ok('empty bible → []',     parseBibleCharacters('').length === 0);
ok('null bible → []',      parseBibleCharacters(null).length === 0);
ok('lowercase ignored',    !has(parseBibleCharacters('max is here'), 'max'));
ok('dedupes repeats',      parseBibleCharacters('Max and Max and Max.').filter(x => x === 'Max').length === 1);
ok('caps at 30 results',   parseBibleCharacters(
  Array.from({length: 50}, (_, i) => `Namezz${String.fromCharCode(65 + (i % 26))}`).join(' ')
).length <= 31);

console.log(`parse-bible-characters: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
