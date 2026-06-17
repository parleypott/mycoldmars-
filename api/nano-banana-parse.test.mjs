// Regression lock + bug fix for the structured-output parsers in
// api/nano-banana.js — the JSON-repair layer that pulls Wordy's (Gemini's)
// `directions`, `block-options`, and `scene-suggestions` out of fenced model
// replies. These run on every QSS tutor turn and had ZERO coverage.
//
// REAL BUG fixed here: tryParseSuggestionArray had NO field-grabber fallback
// tier, unlike its two sibling parsers (parseDirectionsLenient,
// tryParseBlockArray). The documented real-world failure mode — Gemini emits
// an UNESCAPED inner double-quote inside a string value — fails JSON.parse,
// and the truncation-repair tier can't help (wrong problem), so the WHOLE
// suggestion array was silently lost. Directions and blocks recover via the
// field-grabber; suggestions returned []. Added grabSuggestionField + a
// field-grabber tier. The inline RED proof below reconstructs the old
// (field-grabber-less) suggestion parser and asserts it loses everything.
//
// Run: bun api/nano-banana-parse.test.mjs   (or `bun run test`)

import {
  extractDirections,
  parseDirectionsLenient,
  sliceBraceObjects,
  grabField,
  extractBlockOptions,
  tryParseBlockArray,
  normalizeBlocks,
  extractSceneSuggestions,
  tryParseSuggestionArray,
  grabSuggestionField,
  normalizeSuggestions,
} from './nano-banana.js';

let passed = 0, failed = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; fails.push(`✗ ${msg}\n    expected: ${e}\n    actual:   ${a}`); }
}
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; fails.push(`✗ ${msg}`); }
}

// ── THE FIX: scene-suggestion with unescaped inner quote is recovered ──────
{
  // Gemini's documented failure: a stray double-quote inside `visual`.
  const raw = '[{"visual":"a "wide" establishing shot","audio":"swelling strings","rationale":"sets the scale"}]';
  const got = tryParseSuggestionArray(raw);
  eq(got.length, 1, 'unescaped-quote suggestion is recovered (was [] before fix)');
  eq(got[0]?.visual, 'a "wide" establishing shot', 'visual keeps the inner quotes');
  eq(got[0]?.audio, 'swelling strings', 'audio survives the field-grab');
  eq(got[0]?.rationale, 'sets the scale', 'rationale survives the field-grab');
}

// Inline RED PROOF: the OLD parser (no field-grabber tier) drops it entirely.
{
  function oldTryParseSuggestionArray(raw) {
    try {
      const parsed = JSON.parse(raw);
      return normalizeSuggestions(Array.isArray(parsed) ? parsed : [parsed]);
    } catch {}
    let s = raw.trim();
    if (s.startsWith('[')) {
      let depth = 0, lastGoodEnd = -1, inStr = false, esc = false;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) lastGoodEnd = i; }
      }
      if (lastGoodEnd > 0) {
        try { return normalizeSuggestions(JSON.parse(s.slice(0, lastGoodEnd + 1) + ']')); } catch {}
      }
    }
    return [];
  }
  const raw = '[{"visual":"a "wide" shot","audio":"b","rationale":"r"}]';
  eq(oldTryParseSuggestionArray(raw), [], 'RED: old suggestion parser loses the array on one stray quote');
  ok(tryParseSuggestionArray(raw).length === 1, 'GREEN: new parser recovers it');
}

// ── tryParseSuggestionArray regression locks (existing behavior preserved) ──
{
  eq(tryParseSuggestionArray('[{"visual":"v","audio":"a","rationale":"r"}]'),
     [{ visual: 'v', audio: 'a', rationale: 'r' }], 'strict JSON happy path');
  // truncation: one full object + a cut-off second
  eq(tryParseSuggestionArray('[{"visual":"a","audio":"b","rationale":"r"},{"visual":"c'),
     [{ visual: 'a', audio: 'b', rationale: 'r' }], 'truncation closes at last full object');
  // smart quotes + trailing comma still parse via strict after... actually strict fails on smart quotes,
  // but the field-grabber recovers; just assert we get the object back.
  eq(tryParseSuggestionArray('[{"visual":"v only","audio":"","rationale":""}]'),
     [{ visual: 'v only', audio: '', rationale: '' }], 'visual-only object kept');
  // audio-only object kept (visual empty)
  eq(tryParseSuggestionArray('[{"visual":"","audio":"a sound","rationale":"x"}]'),
     [{ visual: '', audio: 'a sound', rationale: 'x' }], 'audio-only object kept');
  // object with neither visual nor audio is dropped
  eq(tryParseSuggestionArray('[{"rationale":"orphan"}]'), [], 'no visual & no audio → dropped');
  // single object (not array)
  eq(tryParseSuggestionArray('{"visual":"v","audio":"a"}'),
     [{ visual: 'v', audio: 'a', rationale: '' }], 'single object normalized to array');
  // garbage → []
  eq(tryParseSuggestionArray('not json at all'), [], 'unparseable garbage → []');
  eq(tryParseSuggestionArray(''), [], 'empty string → []');
}

// ── extractSceneSuggestions: fence extraction + cleanReply ──────────────────
{
  const reply = 'Here you go!\n\n```scene-suggestions\n[{"visual":"v","audio":"a","rationale":"r"}]\n```\n\nMore text.';
  const { sceneSuggestions, cleanReply } = extractSceneSuggestions(reply);
  eq(sceneSuggestions.length, 1, 'closed fence extracted one suggestion');
  ok(!cleanReply.includes('scene-suggestions'), 'fence stripped from cleanReply');
  ok(cleanReply.includes('Here you go!') && cleanReply.includes('More text.'), 'prose preserved');
}
{
  // open/truncated fence — recovered with the truncation note
  const reply = 'intro\n\n```scene-suggestions\n[{"visual":"v","audio":"a","rationale":"r"}]';
  const { sceneSuggestions, cleanReply } = extractSceneSuggestions(reply);
  eq(sceneSuggestions.length, 1, 'open fence recovered');
  ok(cleanReply.includes('truncated'), 'truncation note appended');
}
{
  // ```json fence alias works too
  const { sceneSuggestions } = extractSceneSuggestions('```json\n[{"visual":"v"}]\n```');
  eq(sceneSuggestions.length, 1, 'json fence alias parsed');
}

// ── parseDirectionsLenient: the three tiers ─────────────────────────────────
{
  eq(parseDirectionsLenient('[{"title":"T","description":"D","vibe":"Tense"}]'),
     [{ title: 'T', description: 'D', vibe: 'tense' }], 'directions strict + vibe lowercased');
  // unescaped inner quote → field-grabber tier
  const uq = parseDirectionsLenient('[{"title":"A "Camp Scarlet" intern","description":"x","vibe":"warm"}]');
  eq(uq.length, 1, 'directions field-grabber recovers unescaped quote');
  eq(uq[0].title, 'A "Camp Scarlet" intern', 'directions title keeps inner quotes');
  // smart quotes + trailing comma → light-repair tier
  eq(parseDirectionsLenient('[{“title”:“T”,“description”:“D”,“vibe”:“calm”,}]'),
     [{ title: 'T', description: 'D', vibe: 'calm' }], 'directions smart-quote + trailing-comma repair');
  // object missing title is skipped
  eq(parseDirectionsLenient('[{"description":"no title"}]'), [], 'directions without title dropped');
  // truncated mid-object after one good object → field-grabber recovers the first
  const tr = parseDirectionsLenient('[{"title":"A","description":"first","vibe":"warm"},{"title":"B","description":"cut');
  eq(tr.length, 1, 'directions truncation recovers first complete object');
  eq(tr[0].title, 'A', 'directions truncation keeps object A');
  eq(parseDirectionsLenient(''), [], 'directions empty → []');
}

// ── extractDirections: fence + cleanReply ───────────────────────────────────
{
  const { directions, cleanReply } = extractDirections(
    'pick one:\n\n```directions\n[{"title":"T","description":"D","vibe":"v"}]\n```\n');
  eq(directions.length, 1, 'directions fence extracted');
  ok(!cleanReply.includes('```directions'), 'directions fence stripped');
}

// ── tryParseBlockArray: tiers + field-grabber ───────────────────────────────
{
  eq(tryParseBlockArray('[{"kind":"VO","summary":"s","text":"hello"}]'),
     [{ kind: 'vo', summary: 's', text: 'hello' }], 'blocks strict + kind lowercased');
  // truncation (string-aware)
  eq(tryParseBlockArray('[{"kind":"vo","summary":"s","text":"first"},{"kind":"vo","text":"cut'),
     [{ kind: 'vo', summary: 's', text: 'first' }], 'blocks truncation closes at last full object');
  // unescaped inner quote → field-grabber
  const uq = tryParseBlockArray('[{"kind":"vo","text":"he said "go" now","summary":"s"}]');
  eq(uq.length, 1, 'blocks field-grabber recovers unescaped quote');
  eq(uq[0].text, 'he said "go" now', 'blocks text keeps inner quotes');
  // object with no text is dropped
  eq(tryParseBlockArray('[{"kind":"vo","summary":"s"}]'), [], 'block without text dropped');
  eq(tryParseBlockArray('garbage'), [], 'blocks garbage → []');
}

// ── sliceBraceObjects + grab* primitives ────────────────────────────────────
{
  eq(sliceBraceObjects('x {"a":1} y {"b":2} z'), ['{"a":1}', '{"b":2}'], 'slices balanced objects');
  eq(sliceBraceObjects('no braces here'), [], 'no braces → []');
  eq(sliceBraceObjects('{"outer":{"inner":1}}'), ['{"outer":{"inner":1}}'], 'nested braces stay one object');
  eq(grabField('{"title":"hi","vibe":"calm"}', 'title'), 'hi', 'grabField pulls title, stops at next key');
  eq(grabField('{"title":"hi"}', 'vibe'), '', 'grabField missing key → ""');
  eq(grabSuggestionField('{"visual":"a shot","audio":"x"}', 'visual'), 'a shot', 'grabSuggestionField pulls visual');
  eq(grabSuggestionField('{"audio":"only"}', 'visual'), '', 'grabSuggestionField missing → ""');
}

// ── extractBlockOptions: fence + alias ──────────────────────────────────────
{
  const { blockOptions } = extractBlockOptions('```block-options\n[{"kind":"vo","text":"t"}]\n```');
  eq(blockOptions.length, 1, 'block-options fence parsed');
  const alias = extractBlockOptions('```blockoptions\n[{"kind":"vo","text":"t"}]\n```');
  eq(alias.blockOptions.length, 1, 'blockoptions (no hyphen) alias parsed');
}

// ── normalize* sanity ───────────────────────────────────────────────────────
{
  eq(normalizeSuggestions([{ visual: ' v ', audio: '', rationale: undefined }]),
     [{ visual: 'v', audio: '', rationale: '' }], 'normalizeSuggestions trims + coerces');
  eq(normalizeSuggestions([{ foo: 'bar' }]), [], 'normalizeSuggestions drops object with no visual/audio');
  eq(normalizeBlocks([{ text: '  hi ', kind: 'VO' }]),
     [{ kind: 'vo', summary: '', text: 'hi' }], 'normalizeBlocks trims + lowercases kind');
  eq(normalizeBlocks([{ kind: 'vo' }]), [], 'normalizeBlocks drops object with no text');
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\nnano-banana-parse: ${passed} passed, ${failed} failed`);
if (failed) { console.log(fails.join('\n')); process.exit(1); }
