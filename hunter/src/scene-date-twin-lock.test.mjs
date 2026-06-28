// TWIN-LOCK: extractDateFromClipName lives in TWO module trees that cannot share
// an import (the client bundle in hunter/src/ runs in the browser via Vite; the
// worker in hunter/worker/ runs on Johnny's Mac against Supabase), so the parser
// is hand-copied across:
//   • hunter/src/scene-grouping.js          (client scene grouping, live)
//   • hunter/worker/scene-detection-core.js (worker scene detection, on the Mac)
//
// This function decides the DAY and TIME label of every shoot scene from the
// clip filename (e.g. "20241007-1332-C8757_Proxy.MP4" → 2024-10-07 13:32). Its
// timezone handling has caused REAL, Johnny-facing bugs at least THREE times in
// this repo's history — scene labels drifting a full day on his Pacific machine
// (see the backlog "scene day/time labels drifted a full day on non-UTC machines"
// + "scene-detection WORKER mislabeled scene day/time on Pacific" + "build-corpus
// scene labels timezone-drift" items). The fix was the UTC CONTRACT: construct
// the Date with Date.UTC(...) so the filename's wall-clock round-trips through
// .toISOString() identically on ANY machine timezone.
//
// Each copy already has its OWN unit test — but those are blind to each other,
// and BOTH could be (mis)changed the same way and still pass. This is the missing
// cross-file lock. It does two things the per-file tests can't:
//   1. SAMENESS — runs both copies through one battery and asserts identical Date
//      output, so if a future fix hardens one copy (a new filename pattern, say)
//      and forgets the other, this goes RED naming the drift. Exactly the failure
//      mode that bit derive-fps (commit e0f918e: client had `case 60`, worker
//      never got it).
//   2. THE UTC CONTRACT itself — asserts the parsed wall-clock equals the UTC
//      readback, so swapping EITHER copy to a local-time `new Date(y,m,d,h,mi)`
//      construction goes RED even if both were changed in lockstep. Sameness
//      alone would miss a consistent-but-wrong regression; this catches it.

import { extractDateFromClipName as fromClient } from './scene-grouping.js';
import { extractDateFromClipName as fromWorker } from '../worker/scene-detection-core.js';

const COPIES = [
  ['scene-grouping (client)', fromClient],
  ['scene-detection-core (worker)', fromWorker],
];

let pass = 0, fail = 0;
const fails = [];

// (filename, expected day "YYYY-MM-DD", expected time "HH:MM" | null when no match)
// The wall-clock in the filename IS the expected UTC readback — that's the contract.
const CASES = [
  ['20241007-1332-C8757_Proxy.MP4', '2024-10-07', '13:32'],
  ['19991231-2359-C1.mov',          '1999-12-31', '23:59'], // year/day boundary
  ['20200101-0000-C2.MP4',          '2020-01-01', '00:00'], // midnight (UTC vs local would flip the day)
  ['20240630-2330-C9.mov',          '2024-06-30', '23:30'], // late evening — local TZ would push to next day
  ['A_20200229-0815_x',             '2020-02-29', '08:15'], // leap day, pattern mid-string
  ['nope.mp4',                       null,         null],
  ['',                               null,         null],
  [null,                             null,         null],
  [undefined,                        null,         null],
  ['2024100-1332-C1.mp4',            null,         null],   // too few date digits → no match
];

for (const [name, expDay, expTime] of CASES) {
  // 1. SAMENESS across copies.
  const results = COPIES.map(([label, fn]) => {
    let out;
    try { const d = fn(name); out = d ? d.toISOString() : JSON.stringify(d); }
    catch (e) { out = `THREW:${e && e.name}`; }
    return [label, out];
  });
  const baseline = results[0][1];
  if (!results.every(([, r]) => r === baseline)) {
    fail++;
    fails.push(
      `✗ DRIFT on ${JSON.stringify(name)}:\n` +
      results.map(([l, r]) => `      ${l.padEnd(30)} → ${r}`).join('\n')
    );
    continue;
  }

  // 2. THE UTC CONTRACT — the readback must equal the filename wall-clock.
  for (const [label, fn] of COPIES) {
    const d = fn(name);
    const gotDay = d ? d.toISOString().slice(0, 10) : null;
    const gotTime = d ? d.toISOString().slice(11, 16) : null;
    if (gotDay === expDay && gotTime === expTime) {
      pass++;
    } else {
      fail++;
      fails.push(
        `✗ ${label} broke the UTC contract on ${JSON.stringify(name)}: ` +
        `expected day=${expDay} time=${expTime}, got day=${gotDay} time=${gotTime}`
      );
    }
  }
}

// Guard the lock from silently degrading to "both copies happen to be absent".
if (COPIES.every(([, fn]) => typeof fn === 'function')) pass++;
else { fail++; fails.push('✗ one or more extractDateFromClipName copies failed to import'); }

if (fail) {
  console.error(`\nscene-date-twin-lock: ${pass} passed, ${fail} FAILED\n`);
  console.error(fails.join('\n') + '\n');
  process.exit(1);
}
console.log(`scene-date-twin-lock: ${pass} passed — both copies in lockstep on the UTC contract`);
