/**
 * Tests for the sequence-metadata helpers in csv-parser.js — the functions that
 * build the producer-facing soundbite prefix SOT Hunter copies into producer
 * docs, e.g.  [260322-04-113-Matzu | 22:55.3 → 23:00.5]: TEXT
 * Run: node src/sequence-meta.test.mjs
 *
 * Headline case: a generic diarization label ("Speaker 1", "Speaker 2", …) has
 * a digit but no real name. The digit-strip path in cleanSpeakerName collapsed
 * it to the bare word "Speaker" — erasing the 1/2/3 distinction and merging
 * distinct unnamed speakers into one display name. These three functions had
 * ZERO test coverage despite feeding the producer-facing prefix.
 */
import {
  cleanSpeakerName,
  isGenericSpeaker,
  extractSequenceBase,
  getSequenceMetadata,
  buildSpeakerMap,
} from './csv-parser.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}`); }
};

// ── cleanSpeakerName: real speaker codes still strip correctly ──
eq(cleanSpeakerName('260317-04-104-JERRY - JOHNNY'), 'Johnny', 'clean: strips sequence prefix → trailing speaker');
eq(cleanSpeakerName('260322-04-113-Matzu'), 'Matzu', 'clean: single trailing speaker code');
eq(cleanSpeakerName('Mikael Antell'), 'Mikael Antell', 'clean: plain multiword name preserved');
eq(cleanSpeakerName('ALL JH ONCAM'), 'ALL JH ONCAM', 'clean: no-digit multiword as-is');
eq(cleanSpeakerName(''), '', 'clean: empty');
eq(cleanSpeakerName('   '), '', 'clean: whitespace only');

// ── cleanSpeakerName: generic diarization labels must NOT collapse to "Speaker" ──
eq(cleanSpeakerName('Speaker 1'), 'Speaker 1', 'clean: generic "Speaker 1" kept intact');
eq(cleanSpeakerName('Speaker 2'), 'Speaker 2', 'clean: generic "Speaker 2" stays distinct from 1');
eq(cleanSpeakerName('speaker 3'), 'speaker 3', 'clean: lowercase generic preserved');
eq(cleanSpeakerName('Speaker  10'), 'Speaker  10', 'clean: double-digit generic preserved');
ok(cleanSpeakerName('Speaker 1') !== cleanSpeakerName('Speaker 2'),
   'clean: two unnamed speakers stay distinguishable');

// ── extractSequenceBase: lock documented behavior (everything up to + incl. first speaker code) ──
eq(extractSequenceBase('260317-04-104-JERRY - JOHNNY'), '260317-04-104-JERRY', 'base: up to first alpha speaker code');
eq(extractSequenceBase("260317'-04'-104'-JERRY - JOHNNY"), "260317'-04'-104'-JERRY", 'base: apostrophe-laced name');
eq(extractSequenceBase('260322-04-113-Matzu'), '260322-04-113-Matzu', 'base: single trailing code');
eq(extractSequenceBase('260317-04-104'), '260317-04-104', 'base: all-numeric returned whole');
eq(extractSequenceBase(''), '', 'base: empty passthrough');

// ── getSequenceMetadata: first non-generic speaker is the sequence identifier ──
{
  const meta = getSequenceMetadata([
    { number: 1, speaker: 'Speaker 1', text: 'intro chatter' },
    { number: 2, speaker: '260317-04-104-JERRY - JOHNNY', text: 'real line' },
  ]);
  eq(meta.sequenceName, '260317-04-104-JERRY - JOHNNY', 'meta: skips generic, uses first labeled raw name');
  eq(meta.primarySpeaker, 'Johnny', 'meta: primary speaker cleaned');
  ok(meta.dateFilmed instanceof Date, 'meta: date parsed from YYMMDD prefix');
}
{
  const meta = getSequenceMetadata([]);
  eq(meta.sequenceName, '', 'meta: empty segments → empty name');
  eq(meta.primarySpeaker, '', 'meta: empty segments → empty primary');
  eq(meta.dateFilmed, null, 'meta: empty segments → null date');
}
{
  const meta = getSequenceMetadata([{ number: 1, speaker: 'Speaker 1', text: 'x' }]);
  eq(meta.primarySpeaker, '', 'meta: all-generic → no primary');
}

// ── buildSpeakerMap: distinct raw speakers map to distinct clean names ──
{
  const map = buildSpeakerMap([
    { speaker: '260317-04-104-JERRY - JOHNNY' },
    { speaker: 'Speaker 1' },
    { speaker: 'Speaker 2' },
    { speaker: '260317-04-104-JERRY - JOHNNY' }, // dup — mapped once
  ]);
  eq(map['260317-04-104-JERRY - JOHNNY'], 'Johnny', 'map: real speaker cleaned');
  eq(map['Speaker 1'], 'Speaker 1', 'map: generic 1 preserved');
  eq(map['Speaker 2'], 'Speaker 2', 'map: generic 2 preserved');
  ok(map['Speaker 1'] !== map['Speaker 2'], 'map: unnamed speakers do not collapse to one name');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
