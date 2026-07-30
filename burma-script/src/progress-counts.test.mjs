// progress-counts.test.mjs — locks the FC/TK tally rules against representative doc JSON.
// Run: bun burma-script/src/progress-counts.test.mjs

import assert from 'node:assert';
import { countProgress } from './progress-counts.js';

// Helpers to build ProseMirror-shaped JSON tersely.
const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const fc = (status) => ({ type: 'factCheckSpan', attrs: { status } });
const tk = () => ({ type: 'tkSpan', attrs: {} });
const chip = (tc) => ({ type: 'timecode', attrs: { tc } });
const arch = (status) => ({ type: 'directionMark', attrs: { kind: 'archive', status } }); // 'found' | 'needed'
const para = (...content) => ({ type: 'voBlock', content: [{ type: 'paragraph', content }] });
const doc = (...blocks) => ({ type: 'doc', content: blocks });

let n = 0; const it = (name, fn) => { fn(); n++; };

it('a checked FC counts as done; pending/solid count as open', () => {
  const d = doc(
    para(t('The river is '), t('1,000 miles long', fc('checked')), t(' per the survey.')),
    para(t('There were '), t('ten thousand temples', fc('pending')), t(' at Bagan.')),
    para(t('It fell in '), t('1057', fc('solid')), t('.')),
  );
  const r = countProgress(d);
  assert.equal(r.fc.total, 3, 'three fc claims');
  assert.equal(r.fc.done, 1, 'one checked');
  assert.equal(r.fc.open, 2, 'two still open');
  assert.equal(r.fc.pct, 33, '1/3 → 33%');
});

it('a claim fragmented by an embedded timecode chip is ONE claim, not two', () => {
  const d = doc(para(
    t('as of '), t('the census at ', fc('pending')), chip('02:02:01:07'), t('47 million', fc('pending')), t(' people'),
  ));
  const r = countProgress(d);
  assert.equal(r.fc.total, 1, 'the chip is transparent — one contiguous claim');
  assert.equal(r.fc.open, 1);
});

it('two fc runs separated by plain unmarked text are two claims', () => {
  const d = doc(para(
    t('claim ', fc('checked')), t(' and then plain and then '), t('claim two', fc('pending')),
  ));
  const r = countProgress(d);
  assert.equal(r.fc.total, 2);
  assert.equal(r.fc.done, 1);
});

it('TK spans are an open count with no done-state', () => {
  const d = doc(
    para(t('quick cuts of the market '), t('add a stat', tk()), t(' at dawn')),
    para(t('the exact time was '), t('TKTKTK', tk())),
  );
  const r = countProgress(d);
  assert.equal(r.tk.open, 2, 'two open TKs');
});

it('empty / no-marks doc → fc 100% (nothing to check), zero TKs', () => {
  const r = countProgress(doc(para(t('plain narration, nothing flagged'))));
  assert.equal(r.fc.total, 0);
  assert.equal(r.fc.pct, 100, 'vacuously complete');
  assert.equal(r.tk.open, 0);
});

it('runs never span a block boundary', () => {
  // Same status across two blocks must stay two claims, not merge.
  const d = doc(
    para(t('a', fc('pending'))),
    para(t('b', fc('pending'))),
  );
  assert.equal(countProgress(d).fc.total, 2);
});

it('marks nested in table cells are counted (deep recursion)', () => {
  const d = doc({ type: 'table', content: [
    { type: 'tableRow', content: [
      { type: 'tableCell', content: [{ type: 'paragraph', content: [t('cell claim', fc('checked'))] }] },
    ] },
  ] });
  const r = countProgress(d);
  assert.equal(r.fc.total, 1);
  assert.equal(r.fc.done, 1);
});

it('is null-safe on junk input', () => {
  assert.doesNotThrow(() => countProgress(null));
  assert.doesNotThrow(() => countProgress({}));
  assert.equal(countProgress(undefined).fc.total, 0);
});

it('archive chips: found = collected (done), needed = open', () => {
  const d = doc(
    para(t('pull '), t('the 1962 coup footage', arch('found')), t(' from the vault')),
    para(t('need '), t('street protest b-roll', arch('needed')), t('')),
    para(t('and '), t('the map of Rangoon', arch('found')), t('')),
  );
  const r = countProgress(d);
  assert.equal(r.archive.total, 3, 'three archive chips');
  assert.equal(r.archive.done, 2, 'two found');
  assert.equal(r.archive.open, 1, 'one still needed');
  assert.equal(r.archive.pct, 67, '2/3 → 67%');
});

it('archive: adjacent chips of DIFFERENT status split into two (workspaces.js rule)', () => {
  const d = doc(para(t('found bit', arch('found')), t('needed bit', arch('needed'))));
  const r = countProgress(d);
  assert.equal(r.archive.total, 2, 'status change splits the chip');
  assert.equal(r.archive.done, 1);
});

it('archive default (missing status) is treated as needed/open', () => {
  const d = doc(para(t('unmarked-status asset', { type: 'directionMark', attrs: { kind: 'archive' } })));
  const r = countProgress(d);
  assert.equal(r.archive.total, 1);
  assert.equal(r.archive.done, 0);
});

it('non-archive direction kinds (broll etc.) are NOT counted as archive', () => {
  const broll = { type: 'directionMark', attrs: { kind: 'broll', status: 'found' } };
  const r = countProgress(doc(para(t('some broll cue', broll))));
  assert.equal(r.archive.total, 0, 'only kind:archive chips count');
});

console.log(`ok — progress-counts: ${n} tests passed`);
