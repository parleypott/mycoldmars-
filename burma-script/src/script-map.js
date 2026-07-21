// Burma Script Tool — SCRIPT MAP MODEL (pure, doc-in → data-out).
//
// Johnny: "a mental map of the entire script … color-coded by what the dominant
// visual plan is for each section … what is still missing — if there's a ton of
// pending visual plans or empty right-hand cells that should show up at a glance."
//
// This module turns a ProseMirror doc NODE into the data the SCRIPT MAP view
// (ScriptMap.jsx, ws key 'map') paints: chapters → contiguous same-kind segments,
// each weighted by TIMED WORDS (the workspaces.js taxonomy — words that buy screen
// time), plus roll-up totals. Pure and editor-free, same posture as workspaces.js.
//
// DOMINANT-KIND RULE (per top-level row):
//   1. PENDING override — any block in the row carrying the stage-1 `pendingViz`
//      attr makes the whole row 'pending' (the /pending alert state outranks any
//      chips that survived alongside it).
//   2. Otherwise the dominant VISUAL kind = the directionMark kind with the most
//      marked-text coverage (characters) among VISUAL_KINDS, counted in the SHOWN
//      lane or a FULL-width cell (innermost cell role wins — the timedWordsInRow
//      lane doctrine, mirrored). brollBlock nodes count toward 'broll' (the legacy
//      [data-broll] surface; an empty one still counts a nominal 1 so a bare
//      planned-but-unwritten broll cartridge isn't invisible).
//   3. No visual coverage but the row HAS a shown lane → 'unplanned' — the empty
//      right-hand cell Johnny wants to jump out. (Calibrated on the live Burma doc
//      2026-07-21: of 57 unplanned rows only 5 held >10 word-chars of untagged
//      shown-lane prose — a shown lane with no chip coverage overwhelmingly IS a
//      hole in the plan, so untagged prose rides in the same bucket.)
//   4. No shown lane at all (full-width chapter heads, note rows, bare VO rows)
//      → 'neutral' — structural material, never a hazard. The VIEW paints a
//      zero-word neutral as a hairline but gives a wordy one (the unsplit
//      narration tail: one live run was 35 rows / 622 words ≈ 5 min) a quiet
//      proportional mass, so real screen time can never hide in a hairline.
//
// SMOOTHING (calibrated, see scanRuns): a single-row run of a REAL kind wedged
// between two runs of one same kind is absorbed into its neighbours — one stray
// archive chip inside a long broll passage is texture, not a section. 'pending'
// and 'unplanned' are NEVER smoothed away (they are the alarm the map exists to
// ring), and 'neutral' hairlines never merge with anything.

import {
  walkRows, timedWordsInRow, countWords, WORDS_PER_MINUTE, PENDING_TINT,
} from './workspaces.js';

// The five plan-owning crafts, in tie-break priority order (higher coverage always
// wins first; a dead tie goes to the earlier entry). Tints = the REAL chip palette
// (styles.css .wp-dhl rules) so the map reads in the same ink as the page.
export const VISUAL_KINDS = ['broll', 'archive', 'mapdata', 'animation', '3d'];

export const MAP_KIND_TINTS = {
  broll: '#d0873f',
  archive: '#b56b6b',
  mapdata: '#9c5a3c',
  animation: '#9184c7',
  '3d': '#9184c7', // + yellow #f5e63d edge in CSS — same purple family, keyed apart
  pending: PENDING_TINT,
};

// ── PER-ROW CLASSIFICATION ─────────────────────────────────────────────────────
// Returns { kind, hasShown } where kind ∈ VISUAL_KINDS | 'pending' | 'unplanned'
// | 'neutral'. Exported for the suite.
export function rowDominantKind(rowNode) {
  let pending = false;
  let hasShown = false;
  const coverage = Object.create(null);
  for (const k of VISUAL_KINDS) coverage[k] = 0;

  const visit = (node, lane) => {
    if (node.attrs?.pendingViz === true) pending = true;
    const t = node.type?.name;
    if (t === 'tableCell') {
      const next = node.attrs?.role || 'full';
      if (next === 'shown') hasShown = true;
      node.forEach((c) => visit(c, next));
      return;
    }
    const countsHere = lane === 'shown' || lane === 'full';
    if (t === 'brollBlock') {
      if (countsHere) coverage.broll += Math.max(1, node.textContent.length);
      // still descend — a brollBlock body could carry a pendingViz'd child? (it
      // can't today, but the pending scan must never miss an attr)
    }
    if (node.isText && countsHere && node.marks && node.marks.length) {
      for (const m of node.marks) {
        if (m.type?.name === 'directionMark' && coverage[m.attrs?.kind] !== undefined) {
          coverage[m.attrs.kind] += node.text.length;
        }
      }
      return;
    }
    node.forEach((c) => visit(c, lane));
  };
  visit(rowNode, 'full');

  if (pending) return { kind: 'pending', hasShown };
  let best = null;
  for (const k of VISUAL_KINDS) {
    if (coverage[k] > 0 && (!best || coverage[k] > coverage[best])) best = k;
  }
  if (best) return { kind: best, hasShown };
  return { kind: hasShown ? 'unplanned' : 'neutral', hasShown };
}

// A row is a real hazard only when material exists and no plan does; 'neutral'
// structural rows are exempt from the planned/unplanned arithmetic entirely.
const HAZARD = new Set(['pending', 'unplanned']);

// ── RUN SCAN + SMOOTHING ───────────────────────────────────────────────────────
// rows: [{ index, firstBlockId, kind, timedWords }] in doc order (one chapter's
// worth). Groups consecutive same-kind rows, then (smooth:true) absorbs single-row
// REAL-kind islands whose two neighbours share one kind (see header). Exported for
// the suite.
export function scanRuns(rows, { smooth = true } = {}) {
  const runs = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && last.kind === r.kind) {
      last.rowEnd = r.index;
      last.rowCount += 1;
      last.timedWords += r.timedWords;
    } else {
      runs.push({
        kind: r.kind,
        rowStart: r.index,
        rowEnd: r.index,
        rowCount: 1,
        timedWords: r.timedWords,
        firstBlockId: r.firstBlockId || null,
      });
    }
  }
  if (!smooth) return runs;
  // Smoothing pass — repeat until stable (absorbing an island can make its two
  // neighbours adjacent, which may expose a new island pattern).
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < runs.length - 1; i++) {
      const [a, x, b] = [runs[i - 1], runs[i], runs[i + 1]];
      if (x.rowCount !== 1) continue;
      if (HAZARD.has(x.kind) || x.kind === 'neutral') continue;    // hazards + hairlines stay
      if (a.kind !== b.kind || HAZARD.has(a.kind) || a.kind === 'neutral') continue;
      a.rowEnd = b.rowEnd;
      a.rowCount += x.rowCount + b.rowCount;
      a.timedWords += x.timedWords + b.timedWords;
      runs.splice(i, 2);
      changed = true;
      i -= 1;
    }
  }
  return runs;
}

// ── THE MODEL ──────────────────────────────────────────────────────────────────
// mapModel(doc) → {
//   chapters: [{ ordinal, ord, title, segments, timedWords }]
//     segments: [{ kind, rowStart, rowEnd, rowCount, timedWords, firstBlockId }]
//   totals: { timedWords, minutes, plannedPct, pendingCount, unplannedCount, byKind }
// }
// Rows before the first chapterBlock group under ordinal 0 ("FRONT MATTER").
// plannedPct = planned timed words / (planned + hazard timed words) — the share of
// spoken minutes that already have a visual plan. Hazard rows with zero timed words
// still count as rows (pendingCount / unplannedCount count ROWS, the punch list).
export function mapModel(doc, { smooth = true } = {}) {
  const enriched = walkRows(doc).map((r) => {
    const { kind } = rowDominantKind(r.node);
    return {
      index: r.index,
      firstBlockId: r.firstBlockId,
      chapter: r.chapter,
      kind,
      timedWords: timedWordsInRow(r.node),
    };
  });

  // Group into chapters (doc order; walkRows already attributes every row).
  const chapters = [];
  let cur = null;
  for (const r of enriched) {
    const ordinal = r.chapter ? r.chapter.ordinal : 0;
    if (!cur || cur.ordinal !== ordinal) {
      cur = {
        ordinal,
        ord: r.chapter ? r.chapter.ord : '00',
        title: r.chapter ? r.chapter.title : 'FRONT MATTER',
        rows: [],
      };
      chapters.push(cur);
    }
    cur.rows.push(r);
  }

  const totalsByKind = Object.create(null);
  let plannedWords = 0, hazardWords = 0;
  let pendingCount = 0, unplannedCount = 0;
  let timedWords = 0;

  const outChapters = chapters.map((ch) => {
    const segs = scanRuns(ch.rows, { smooth });
    let chWords = 0;
    for (const s of segs) {
      chWords += s.timedWords;
      const k = s.kind;
      if (!totalsByKind[k]) totalsByKind[k] = { rows: 0, timedWords: 0, sections: 0 };
      totalsByKind[k].rows += s.rowCount;
      totalsByKind[k].timedWords += s.timedWords;
      totalsByKind[k].sections += 1;
    }
    return { ordinal: ch.ordinal, ord: ch.ord, title: ch.title, segments: segs, timedWords: chWords };
  });

  for (const r of enriched) {
    timedWords += r.timedWords;
    if (VISUAL_KINDS.includes(r.kind)) plannedWords += r.timedWords;
    else if (r.kind === 'pending') { pendingCount += 1; hazardWords += r.timedWords; }
    else if (r.kind === 'unplanned') { unplannedCount += 1; hazardWords += r.timedWords; }
  }
  const denom = plannedWords + hazardWords;
  const plannedPct = denom > 0 ? Math.round((plannedWords / denom) * 100) : 100;

  return {
    chapters: outChapters,
    totals: {
      timedWords,
      minutes: timedWords / WORDS_PER_MINUTE,
      plannedPct,
      pendingCount,
      unplannedCount,
      byKind: totalsByKind,
    },
  };
}

// ── VIEW LAYOUT MATH (pure — ScriptMap.jsx imports these; kept here so the
// headless suite exercises the same pixels the view paints). ──────────────────
//
// Calibrated on the live Burma doc (331 rows / 40.2 min): ~0.30 px/word ≈ 39px
// per screen minute keeps the whole film ~1.9k px tall — one confident scroll —
// while the 3px/row floor keeps zero-narration visual rows (a broll run whose
// said lane isn't written yet) from vanishing.
export const PX_PER_WORD = 0.3;
export const ROW_PX = 3;          // per-row floor for word-empty segments
export const HAIRLINE_PX = 3;     // zero-word neutral (chapter heads, spacers)
export const MIN_SEG_PX = 14;     // any planned/hazard segment stays visible
export const MIN_NEUTRAL_PX = 10; // wordy neutral mass floor
export const TICK_EVERY_MIN = 2;

export const MAP_KIND_LABELS = {
  broll: 'B-ROLL',
  archive: 'ARCHIVE',
  mapdata: 'MAP DATA',
  animation: 'ANIMATION',
  '3d': '3D',
  pending: 'PENDING VISUAL PLAN',
  unplanned: 'UNPLANNED',
  neutral: '',
};

export function segmentPx(seg) {
  if (seg.kind === 'neutral') {
    if (!seg.timedWords) return HAIRLINE_PX;
    return Math.max(MIN_NEUTRAL_PX, Math.round(seg.timedWords * PX_PER_WORD));
  }
  return Math.max(
    MIN_SEG_PX,
    Math.round(seg.timedWords * PX_PER_WORD),
    seg.rowCount * ROW_PX,
  );
}

export function segmentTag(seg) {
  const rows = seg.rowStart === seg.rowEnd ? `ROW ${seg.rowStart}` : `ROWS ${seg.rowStart}–${seg.rowEnd}`;
  if (!seg.timedWords) return rows;
  return `${rows} · ${(seg.timedWords / WORDS_PER_MINUTE).toFixed(1)} MIN`;
}

// Per-chapter layout: explicit px per segment + the cumulative-minute ticks that
// land inside this chapter's column (y measured from the column top; ticks fall
// only inside word-carrying segments — a boundary can't land in a 0-word bar).
// `startWords` = cumulative timed words of the whole film before this chapter.
export function layoutChapter(chapter, startWords) {
  const every = TICK_EVERY_MIN * WORDS_PER_MINUTE;
  const segs = [];
  const ticks = [];
  let y = 0;
  let words = startWords;
  for (const seg of chapter.segments) {
    const px = segmentPx(seg);
    if (seg.timedWords > 0) {
      let b = Math.floor(words / every) * every + every;
      while (b <= words + seg.timedWords) {
        ticks.push({ min: b / WORDS_PER_MINUTE, y: Math.round(y + ((b - words) / seg.timedWords) * px) });
        b += every;
      }
    }
    segs.push({ ...seg, px, y });
    y += px + 1; // 1px seam between bars (page shows through — flat mosaic)
    words += seg.timedWords;
  }
  return { segs, ticks, colPx: Math.max(0, y - 1), endWords: words };
}

export { countWords };
