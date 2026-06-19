// Tests for translation/src/copilot/copilot-prompts.js — the prompt-assembly
// core behind the Interpreter's editorial AI copilot (Johnny's transcript tool).
//
// No live bug found: this is a verifier-layer LOCK of a load-bearing,
// zero-coverage pure module. Every assertion is mutation-proven to go RED if the
// corresponding logic regresses (see the mutation log in the backlog entry).
//
// The internal window builders (buildLocalWindow / buildFullTranscriptContext)
// are NOT exported, but both are reachable through buildCopilotSystemPrompt:
//   deepContext:false + a selection  -> buildLocalWindow
//   deepContext:true                 -> buildFullTranscriptContext
// So this test imports ONLY the real shipped exports — zero source change.

import {
  buildCopilotSystemPrompt,
  buildPassagePrompt,
  buildMultiHighlightPrompt,
  buildSummaryPrompt,
  buildAutoSummaryPrompt,
  QUICK_ACTIONS,
} from './copilot-prompts.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
};
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// ── fixtures ────────────────────────────────────────────────────────────────
// 30 segments numbered 1..30 (index i -> number i+1), translations PARALLEL by
// index (translations[i] corresponds to segments[i]). The translated text
// embeds the index so we can prove which translation was pulled for a segment.
const segments = Array.from({ length: 30 }, (_, i) => ({
  number: i + 1,
  speaker: i % 2 === 0 ? 'A' : 'B',
  start: `0:${String(i).padStart(2, '0')}`,
  text: `orig-${i + 1}`,
}));
const translations = segments.map((_, i) => ({ translated: `trans-idx${i}` }));
const speakerMap = { A: 'Alice', B: 'Bob' };

// ── buildCopilotSystemPrompt: default (string) shape ────────────────────────
{
  const out = buildCopilotSystemPrompt({
    summary: 'A talk about rivers.',
    segments, translations, speakerMap,
    selection: { segmentNumber: 15 },
    deepContext: false,
  });
  ok(typeof out === 'string', 'default mode returns a string');
  ok(out.includes('editorial assistant for a documentary filmmaker'), 'default carries the intro');
  ok(out.includes('INTERVIEW SUMMARY:\nA talk about rivers.'), 'default embeds the summary block');
  ok(out.includes('TRANSCRIPT CONTEXT:'), 'default includes the local window context');
  ok(out.includes('GUIDELINES:'), 'default carries the guidelines block');
  ok(out.includes('[[suggestion:'), 'default keeps the suggestion-format instruction');
}

// summary omitted -> no summary block, no stray label
{
  const out = buildCopilotSystemPrompt({
    summary: '', segments, translations, speakerMap,
    selection: { segmentNumber: 15 }, deepContext: false,
  });
  ok(!out.includes('INTERVIEW SUMMARY:'), 'no summary -> no summary label');
}

// ── buildLocalWindow math (driven through default mode) ─────────────────────
// Selection at segment number 15 (index 14): window is indices [4 .. 24],
// i.e. segment numbers 5..25 — 10 before, the selected, 10 after.
{
  const out = buildCopilotSystemPrompt({
    summary: '', segments, translations, speakerMap,
    selection: { segmentNumber: 15 }, deepContext: false,
  });
  ok(out.includes('[5]'), 'window starts 10 segments before selection (seg 5 present)');
  ok(!out.includes('[4]'), 'window does NOT reach 11 before (seg 4 absent)');
  ok(out.includes('[25]'), 'window ends 10 segments after selection (seg 25 present)');
  ok(!out.includes('[26]'), 'window does NOT reach 11 after (seg 26 absent)');
  // SELECTED marker only on the selected segment
  ok(out.includes('[15]') && out.includes('<<<SELECTED>>>'), 'selected segment is marked');
  ok((out.match(/<<<SELECTED>>>/g) || []).length === 1, 'exactly one SELECTED marker');
  ok(/\[15\][^\n]*<<<SELECTED>>>/.test(out), 'the marker sits on segment 15, not a neighbour');
  // KEY parallel-indexing lock: segment 15 (index 14) must show trans-idx14,
  // NOT trans-idx10 (its window-local index would be 10). This catches a
  // translations[i] (window-local) regression vs translations[start+i].
  ok(out.includes('Original: orig-15'), 'window shows the selected original');
  // Block-specific lock: the SELECTED segment (15, absolute index 14) must show
  // trans-idx14 in ITS block. Its window-LOCAL position is 10, so a
  // translations[i] regression would render trans-idx10 here instead. (Note
  // trans-idx10 also legitimately appears elsewhere — for segment 11 — so the
  // assertion must be scoped to the selected segment's block, not the whole string.)
  ok(/\[15\][^\n]*<<<SELECTED>>>\n\s*Original: orig-15\n\s*Translation: trans-idx14/.test(out),
     'selected segment block uses ABSOLUTE-index translation (catches window-local regression)');
  // first window segment (seg 5, index 4) pulls trans-idx4
  ok(out.includes('Translation: trans-idx4'), 'first window segment pulls its absolute-index translation');
}

// window clamps at the head (selection near the start)
{
  const out = buildCopilotSystemPrompt({
    summary: '', segments, translations, speakerMap,
    selection: { segmentNumber: 2 }, deepContext: false,
  });
  ok(out.includes('[1]'), 'head-clamped window includes segment 1');
  ok(out.includes('[12]'), 'head-clamped window still extends 10 past selection (seg 12)');
  ok(!out.includes('[13]'), 'head-clamped window stops at +10 (seg 13 absent)');
}

// window clamps at the tail
{
  const out = buildCopilotSystemPrompt({
    summary: '', segments, translations, speakerMap,
    selection: { segmentNumber: 29 }, deepContext: false,
  });
  ok(out.includes('[30]'), 'tail-clamped window includes the last segment (30)');
  ok(out.includes('[19]'), 'tail-clamped window extends 10 before (seg 19)');
  ok(!out.includes('[18]'), 'tail-clamped window stops at -10 (seg 18 absent)');
}

// no selection / unknown segment -> empty window, no TRANSCRIPT CONTEXT label
{
  const noSel = buildCopilotSystemPrompt({
    summary: 'S', segments, translations, speakerMap,
    selection: null, deepContext: false,
  });
  ok(!noSel.includes('TRANSCRIPT CONTEXT:'), 'no selection -> no transcript-context block');
  const badSel = buildCopilotSystemPrompt({
    summary: 'S', segments, translations, speakerMap,
    selection: { segmentNumber: 9999 }, deepContext: false,
  });
  ok(!badSel.includes('TRANSCRIPT CONTEXT:'), 'unknown segment -> empty window, no context block');
}

// untranslated window segment (translated === original) renders the single-line form
{
  const segs2 = [{ number: 1, speaker: 'A', start: '0:00', text: 'same' }];
  const trans2 = [{ translated: 'same' }];
  const out = buildCopilotSystemPrompt({
    summary: '', segments: segs2, translations: trans2, speakerMap,
    selection: { segmentNumber: 1 }, deepContext: false,
  });
  ok(!out.includes('Original:'), 'when translation === original, no Original/Translation split');
  ok(out.includes('[1] Alice (0:00): <<<SELECTED>>> same'), 'single-line form carries number/speaker/text');
}

// ── buildCopilotSystemPrompt: deep context (content-block array) shape ──────
{
  const out = buildCopilotSystemPrompt({
    summary: 'Sum.', segments, translations, speakerMap,
    selection: { segmentNumber: 15 }, deepContext: true,
  });
  ok(Array.isArray(out), 'deepContext returns a content-block array');
  ok(out.length === 2, 'deepContext returns exactly two blocks');
  ok(out[0].type === 'text' && out[0].text.includes('INTERVIEW SUMMARY:\nSum.'), 'block 0 carries intro+summary+guidelines');
  ok(out[0].text.includes('GUIDELINES:'), 'block 0 carries the guidelines');
  ok(out[1].type === 'text' && out[1].text.startsWith('TRANSCRIPT CONTEXT:'), 'block 1 is the full transcript');
  // The cache_control on block 1 is the whole point of the deep-context split
  // (prompt caching cuts repeat input cost ~10x) — lock it.
  ok(out[1].cache_control && out[1].cache_control.type === 'ephemeral', 'block 1 is marked cacheable (ephemeral)');
  ok(out[0].cache_control === undefined, 'block 0 is NOT cache-marked (it varies per call)');
  // full transcript covers ALL segments (not just a window) with absolute indexing
  ok(out[1].text.includes('[1]') && out[1].text.includes('[30]'), 'full transcript spans every segment');
  ok(out[1].text.includes('Translation: trans-idx29'), 'full transcript indexes translations in parallel');
}

// ── buildPassagePrompt ──────────────────────────────────────────────────────
{
  const p = buildPassagePrompt({
    text: 'the river rose', originalText: '河水上涨', speaker: 'Alice',
    timecode: '1:02:03', tags: ['flood', 'memory'],
  }, 'What does this reveal?');
  ok(p.includes('HIGHLIGHTED PASSAGE:'), 'passage prompt has the passage header');
  ok(p.includes('Translation: the river rose'), 'passage prompt carries the translation');
  ok(p.includes('Original: 河水上涨'), 'passage prompt carries the original');
  ok(p.includes('Speaker: Alice'), 'passage prompt carries the speaker');
  ok(p.includes('Timecode: 1:02:03'), 'passage prompt carries the timecode');
  ok(p.includes('Tags: flood, memory'), 'passage prompt joins tags');
  ok(p.trimEnd().endsWith('What does this reveal?'), 'passage prompt ends with the question');
}
// no-text selection -> just the question, no passage header
{
  const p = buildPassagePrompt({}, 'Plain question');
  ok(!p.includes('HIGHLIGHTED PASSAGE:'), 'empty selection -> no passage header');
  eq(p, 'Plain question', 'empty selection -> prompt is exactly the question');
}
// optional fields omitted -> their labels are absent
{
  const p = buildPassagePrompt({ text: 'just text' }, 'Q');
  ok(p.includes('Translation: just text'), 'text-only passage shows the translation');
  ok(!p.includes('Original:') && !p.includes('Speaker:') && !p.includes('Tags:'), 'absent optional fields omit their labels');
}

// ── buildMultiHighlightPrompt ───────────────────────────────────────────────
{
  const hs = [
    { transcriptName: 'Tape A', textPreview: 'first', originalTextPreview: 'orig1', tagName: 'theme' },
    { textPreview: 'second' },
  ];
  const m = buildMultiHighlightPrompt(hs, 'Compare these.');
  ok(m.startsWith('SELECTED PASSAGES:'), 'multi-highlight header present');
  ok(m.includes('[1] From "Tape A":'), 'first highlight 1-based + named');
  ok(m.includes('[2] From "Unknown":'), 'second highlight 1-based + Unknown fallback');
  ok(m.includes('Text: first') && m.includes('Text: second'), 'each highlight carries its text');
  ok(m.includes('Original: orig1'), 'original preview included when present');
  ok(m.includes('Tag: theme'), 'tag included when present');
  ok(!/\[0\] From/.test(m), 'numbering is 1-based, never [0]');
  ok(m.trimEnd().endsWith('Compare these.'), 'ends with the question');
}

// ── buildSummaryPrompt: tag grouping ────────────────────────────────────────
{
  const hs = [
    { tagName: 'Flood', textPreview: 'a', originalTextPreview: 'oa' },
    { tagName: 'Memory', textPreview: 'b' },
    { tagName: 'Flood', textPreview: 'c' },
    { textPreview: 'd' }, // untagged
  ];
  const s = buildSummaryPrompt(hs, 'rivers and loss');
  ok(s.includes('EDITORIAL FOCUS: rivers and loss'), 'editorial focus embedded');
  ok(s.includes('## Flood'), 'Flood tag heading present');
  ok(s.includes('## Memory'), 'Memory tag heading present');
  ok(s.includes('## Untagged'), 'untagged items grouped under Untagged');
  // both Flood items appear under one heading -> grouping really merges by tag
  const floodBlock = s.slice(s.indexOf('## Flood'));
  ok(floodBlock.includes('"a"') && floodBlock.includes('"c"'), 'both Flood items grouped together');
  ok(s.includes('(原文: "oa")'), 'original preview rendered with the 原文 label');
  ok(s.includes('1. **Thematic Analysis**'), 'the 5-part output spec is present');
  ok(s.includes('5. **Translation Notes**'), 'output spec runs through all five points');
}
// no editorial focus -> no focus label
{
  const s = buildSummaryPrompt([{ tagName: 'X', textPreview: 'y' }], '');
  ok(!s.includes('EDITORIAL FOCUS:'), 'no focus -> no focus label');
}

// ── buildAutoSummaryPrompt ──────────────────────────────────────────────────
{
  const a = buildAutoSummaryPrompt(segments, translations, speakerMap);
  ok(a.includes('chronological narrative summary'), 'auto-summary asks for chronological narrative');
  ok(a.includes('[1] Alice: trans-idx0'), 'auto-summary uses translated text when present, parallel-indexed');
  ok(a.includes('[30] Bob: trans-idx29'), 'auto-summary covers the last segment with its parallel translation');
  ok(a.includes('TRANSCRIPT:'), 'auto-summary embeds the transcript block');
}
// no translations -> falls back to original text
{
  const a = buildAutoSummaryPrompt(segments, [], speakerMap);
  ok(a.includes('[1] Alice: orig-1'), 'no translations -> auto-summary uses original text');
  ok(!a.includes('trans-idx'), 'no translations -> no translated text leaks in');
}

// ── QUICK_ACTIONS ───────────────────────────────────────────────────────────
ok(Array.isArray(QUICK_ACTIONS) && QUICK_ACTIONS.length === 3, 'three quick actions');
ok(QUICK_ACTIONS.every(q => typeof q.label === 'string' && typeof q.prompt === 'string'), 'each quick action has label + prompt');
ok(QUICK_ACTIONS.some(q => q.prompt.includes('[[suggestion:')), 'alternative-translation action carries the apply format');

console.log(`\ncopilot-prompts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
