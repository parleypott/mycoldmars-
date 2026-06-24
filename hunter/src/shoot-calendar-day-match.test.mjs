// Regression lock for the Hunter shoot-calendar → scenes-day click navigation.
//
// THE BUG: the calendar click handler used to find the target scenes-day by a
// fuzzy localized-label substring match:
//   labelText.includes(new Date(day+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}))
// The needle for the 1st of a month is "Jun 1", which is a SUBSTRING of the
// labels for the 10th–19th ("Jun 18", "Jun 19", ...). So clicking the calendar
// cell for one day could scroll to a completely different day.
//
// THE FIX: tag each scenes-day with data-day="<ISO>" and select by exact ISO
// (`document.querySelector('.scenes-day[data-day="<iso>"]')`).
//
// These tests don't need a DOM — they reproduce the two matching strategies as
// pure functions and prove the OLD one collides while the NEW one doesn't.

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`); } };
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error(`✗ ${msg}\n    got:  ${g}\n    want: ${w}`); }
};

// The OLD strategy: compared the click's localized needle against the scenes-day's
// localized label via String.includes — exactly what the shipped handler did.
function oldMatches(clickIso, labelIso) {
  const needle = new Date(clickIso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const label = new Date(labelIso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return label.includes(needle);
}

// The NEW strategy: exact ISO equality (the data-day attribute selector).
const newMatches = (clickIso, labelIso) => clickIso === labelIso;

// ── RED proof: the OLD strategy over-matches (this WAS the bug) ───────────────
ok(oldMatches('2026-06-01', '2026-06-18'), 'OLD: click Jun 1 wrongly matched scenes for Jun 18 (the bug)');
const oldCollisions = ['2026-06-10', '2026-06-12', '2026-06-18', '2026-06-19']
  .filter(labelIso => oldMatches('2026-06-01', labelIso));
ok(oldCollisions.length === 4, 'OLD: "Jun 1" collided with all of Jun 10/12/18/19');

// ── GREEN: exact-ISO matches ONLY the clicked day ────────────────────────────
const allDays = ['2026-06-01', '2026-06-10', '2026-06-12', '2026-06-18', '2026-06-19'];
for (const clickIso of allDays) {
  const matched = allDays.filter(labelIso => newMatches(clickIso, labelIso));
  eq(matched, [clickIso], `NEW: click ${clickIso} matches exactly one day`);
}

// The prefix trap is closed.
ok(newMatches('2026-06-01', '2026-06-18') === false, 'NEW: Jun 1 does not match Jun 18');
ok(newMatches('2026-06-02', '2026-06-20') === false, 'NEW: Jun 2 does not match Jun 20');
ok(newMatches('2026-06-01', '2026-06-01') === true, 'NEW: Jun 1 matches Jun 1');

// Cross-month / cross-year days stay distinct.
ok(newMatches('2026-06-01', '2026-07-01') === false, 'NEW: month boundary distinct');
ok(newMatches('2026-06-01', '2025-06-01') === false, 'NEW: year boundary distinct');
ok(newMatches('2026-12-31', '2026-12-31') === true, 'NEW: year-end matches itself');

console.log(`shoot-calendar-day-match: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
