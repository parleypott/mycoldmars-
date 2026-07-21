// Burma Script Tool — WORKSPACES DATA CORE (pure, doc-in → data-out).
//
// The brains behind the per-craft WORKSPACE views (stage 3/4 UIs): who owns which rows,
// how the member rows group into contiguous sections, which chapter each section lives
// under, and how much SCREEN TIME the material represents. This module is deliberately
// free of editor dependencies — it walks a ProseMirror doc NODE (live `state.doc` or a
// headless `PMNode.fromJSON`) and returns plain data, so the same functions drive the
// UI, the row-number decorations (extensions/row-numbers.js) and the headless suite.
//
// MEMBERSHIP GROUND TRUTH — the ROLE FOCUS HUB's lens selectors (roles.js ROLE_DEFS):
// each craft lights on its directionMark kind (`.wp-dhl[data-kind="…"]`), plus, for the
// two crafts with a parallel legacy surface, that surface too (fact-check `[data-fc]`
// spans = the factCheckSpan mark; b-roll `[data-broll]` = the brollBlock node). VO is a
// BLOCK craft (`[data-vo]` = voBlock), and PENDING is the stage-1 `pendingViz` block
// attr (/pending — no lens counterpart). workspaces.test.mjs pins the workspace↔lens
// agreement for every overlapping craft so the two lists can never silently drift.
// (The legacy `directionChip` atom renders `.wp-dchip`, which the lens does NOT match —
// so it is deliberately not a membership surface here either.)

import { ROLE_DEFS } from './roles.js';
import { rowFirstBlockId } from './extensions/table.js';

// ───────────────────────────────────────────────────────────────────────────
// TIMED-WORD TAXONOMY — Johnny's rule, encoded once:
//
//   TIME = WORDS THAT WILL ACTUALLY BE SPOKEN IN THE FILM.
//
// A script minute is bought with spoken words, nothing else. So the timed set is
// exactly the block types whose body is VERBATIM speech:
//
//   • voBlock      — verbatim narration. The narration spine; every word is read aloud.
//   • oncamBlock   — verbatim on-camera speech (Johnny to lens). Spoken word for word.
//   • sotBlock     — verbatim interview quotes. SOTs consume real screen time exactly
//                    like narration does. (Editor.jsx telemetry EXCLUDES sot from its
//                    `words` stat — that stat answers "how much do I still have to
//                    write/narrate?", a different question. Screen time includes them.)
//   • montageBlock — INCLUDED, matching telemetry's vo/oncam/montage precedent. Why:
//                    a montage cartridge's body is the narration spoken OVER the shot
//                    sequence, not a shot list — the parser routes "[montage of …]"
//                    shot descriptions to BROLL (parser.ts isBroll), never to montage,
//                    and the editor treats montage text as narration-grade prose
//                    (slash-menu.js VO_CONVERTIBLE converts a montageBlock's body
//                    verbatim into a voBlock). Same words, same clock.
//
// UNTIMED, never counted: direction/prose carts (binBlock), notes (noteBlock),
// brollBlock (shot descriptions — the picture takes time, the words describing it
// don't), chapter/scene heads (chapterBlock/sceneBlock — labels), noneBlock (untyped),
// imageBlock (no prose) — anything that SUMMARIZES rather than scripts.
//
// LANE RULE: spoken words live in the `said` lane (or a full-width cell). A timed-type
// block sitting in a `shown` lane is visual planning material, not narration — it does
// not tick the clock. workspaceMetrics counts said + full cells only.
export const TIMED_BLOCK_TYPES = new Map([
  ['voBlock', 'verbatim narration — read aloud word for word'],
  ['oncamBlock', 'verbatim on-camera speech'],
  ['sotBlock', 'verbatim interview quote — SOTs carry real screen time'],
  ['montageBlock', 'narration spoken over the montage (telemetry precedent; VO-convertible verbatim)'],
]);

export function isTimedBlock(node) {
  return TIMED_BLOCK_TYPES.has(node?.type?.name);
}

// Script pace: words of spoken material per minute of screen time.
export const WORDS_PER_MINUTE = 130;

// The telemetry word rule, verbatim (Editor.jsx): whitespace-split, keep word-ish tokens.
export function countWords(text) {
  const t = String(text || '');
  if (!t) return 0;
  return t.split(/\s+/).filter((w) => /\w/.test(w)).length;
}

// ───────────────────────────────────────────────────────────────────────────
// THE ROLE REGISTRY — one ordered list, one truth (same doctrine as roles.js).
//
// Each entry's `surfaces` is the machine-readable membership spec — the atoms the
// contract test binds to the lens selectors:
//   markKinds  → directionMark marks with attrs.kind in the list  (.wp-dhl[data-kind])
//   markTypes  → marks by type name                               ([data-fc] = factCheckSpan)
//   blockTypes → block nodes by type name                         ([data-vo]/[data-broll])
//   attrFlags  → block attrs that are strictly `true`             (pendingViz — stage 1)

// Hub tint: reuse the lens craft's color where the crafts overlap, so a crew member's
// workspace reads in the same ink as their lens legend. Match by ROLE_DEFS id, falling
// back to the entry whose selector carries our kind (mapdata lives under id "cartography").
function lensTint(key) {
  const def = ROLE_DEFS.find((r) => r.id === key)
    || ROLE_DEFS.find((r) => r.sel.includes(`data-kind="${key}"`));
  return def ? def.tint : null;
}

// PENDING has no lens craft — it wears the stage-1 alert red (/pending cell paint).
export const PENDING_TINT = '#b02318';

export const WORKSPACE_ROLES = [
  { key: '3d',        label: '3D ANIMATION',        tint: lensTint('3d'),        surfaces: { markKinds: ['3d'] } },
  { key: 'animation', label: 'ANIMATION',           tint: lensTint('animation'), surfaces: { markKinds: ['animation'] } },
  { key: 'archive',   label: 'ARCHIVE',             tint: lensTint('archive'),   surfaces: { markKinds: ['archive'] } },
  { key: 'broll',     label: 'B-ROLL',              tint: lensTint('broll'),     surfaces: { markKinds: ['broll'], blockTypes: ['brollBlock'] } },
  { key: 'mapdata',   label: 'MAP DATA',            tint: lensTint('mapdata'),   surfaces: { markKinds: ['mapdata'] } },
  { key: 'factcheck', label: 'FACT CHECK',          tint: lensTint('factcheck'), surfaces: { markKinds: ['factcheck'], markTypes: ['factCheckSpan'] } },
  { key: 'vo',        label: 'VO',                  tint: lensTint('vo'),        surfaces: { blockTypes: ['voBlock'] } },
  { key: 'pending',   label: 'PENDING VISUAL PLAN', tint: PENDING_TINT,          surfaces: { attrFlags: ['pendingViz'] } },
];

export function workspaceRole(key) {
  return WORKSPACE_ROLES.find((r) => r.key === key) || null;
}

// Does this ROW (top-level tableRow, nested rows included via descendants) contain the
// craft's surface? Accepts a role entry or its key. Mirrors the CSS lens exactly: the
// lens re-lights a row iff the row `:has(<sel>)` — i.e. iff any descendant matches.
export function rowIsMember(rowNode, role) {
  const r = typeof role === 'string' ? workspaceRole(role) : role;
  if (!r || !rowNode) return false;
  const s = r.surfaces || {};
  let hit = false;
  rowNode.descendants((node) => {
    if (hit) return false;
    if (s.blockTypes && s.blockTypes.includes(node.type?.name)) { hit = true; return false; }
    if (s.attrFlags && s.attrFlags.some((a) => node.attrs?.[a] === true)) { hit = true; return false; }
    if ((s.markKinds || s.markTypes) && node.marks && node.marks.length) {
      for (const m of node.marks) {
        if (s.markKinds && m.type?.name === 'directionMark' && s.markKinds.includes(m.attrs?.kind)) { hit = true; return false; }
        if (s.markTypes && s.markTypes.includes(m.type?.name)) { hit = true; return false; }
      }
    }
    return true;
  });
  return hit;
}

// ───────────────────────────────────────────────────────────────────────────
// ROW ENUMERATION — the single source of truth for master-script row numbers.
//
// walkTopRows is the CHEAP walk (O(top-level rows), no descent) that the row-number
// decoration plugin re-runs on every doc change; walkRows builds on the very same
// enumeration and enriches each row with identity + chapter, so the margin number and
// the workspace index can never disagree (row-numbers.test.mjs pins the 1:1 match).
//
// TOP-LEVEL ONLY: Palau docs legally nest rows (tableRow > tableCell > tableRow) —
// a nested said|shown pair is part of its wrapper's band, so it gets NO number of its
// own. Bare top-level strays (the trailing-paragraph peace treaty, scriptStart) are
// not rows and are not numbered.
export function walkTopRows(doc) {
  const rows = [];
  doc.forEach((node, pos) => {
    if (node.type?.name !== 'tableRow') return;
    rows.push({ index: rows.length + 1, pos, node });
  });
  return rows;
}

// Chapter title, telemetry-consistent (Editor.jsx): the FIRST paragraph is the title,
// bracketed asides / {TK…} stripped when words remain, word-boundary clamp at 72.
export function chapterTitle(chapterNode) {
  let first = null;
  chapterNode.forEach((child) => { if (!first && child.type?.name === 'paragraph') first = child; });
  let title = (first || chapterNode).textContent.replace(/\s+/g, ' ').trim();
  const bare = title.replace(/\[[^\]]*\]|\{TK[^}]*\}/gi, '').replace(/\s+/g, ' ').trim();
  if (bare) title = bare;
  if (title.length > 72) title = title.slice(0, 72).replace(/\s+\S*$/, '') + '…';
  return title;
}

// Enumerate TOP-LEVEL rows in order, each carrying:
//   index        — 1-based master row number (the margin number, byte-identical to
//                  walkTopRows / the data-rownum decoration)
//   pos          — doc position just before the tableRow node
//   node         — the tableRow node itself
//   firstBlockId — the row's stable identity (extensions/table.js rowFirstBlockId)
//   chapter      — { ordinal, ord, title } of the most recent row containing a
//                  chapterBlock at or before this row (null before the first chapter).
//                  ordinal is 1-based; ord is the telemetry-style zero-padded string
//                  ("01") the outline renders. A row that OPENS a chapter belongs to it.
export function walkRows(doc) {
  const out = [];
  let chapterCount = 0;
  let chapter = null;
  for (const { index, pos, node } of walkTopRows(doc)) {
    // Scan the whole row (nested rows included) for chapter openers — the LAST one in
    // the row owns everything from this row on. (telemetry's flat walk misses a chapter
    // buried in a NESTED row; this superset counts it, keeping every following row
    // attributed rather than orphaned.)
    node.descendants((child) => {
      if (child.type?.name === 'chapterBlock') {
        chapterCount += 1;
        chapter = { ordinal: chapterCount, ord: String(chapterCount).padStart(2, '0'), title: chapterTitle(child) };
      }
      return true;
    });
    out.push({ index, pos, node, firstBlockId: rowFirstBlockId(node), chapter });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// WORKSPACE SCAN — membership per top-level row, grouped into contiguous runs.
// Each section: { startIndex, endIndex, rowCount, chapter, firstBlockId } where
// chapter + firstBlockId belong to the section's FIRST row (its anchor).
export function scanWorkspace(doc, roleKey) {
  const role = typeof roleKey === 'string' ? workspaceRole(roleKey) : roleKey;
  if (!role) return [];
  const sections = [];
  let open = null;
  for (const row of walkRows(doc)) {
    if (rowIsMember(row.node, role)) {
      if (open) { open.endIndex = row.index; open.rowCount += 1; }
      else open = { startIndex: row.index, endIndex: row.index, rowCount: 1, chapter: row.chapter, firstBlockId: row.firstBlockId };
    } else if (open) { sections.push(open); open = null; }
  }
  if (open) sections.push(open);
  return sections;
}

// Timed words in ONE row: TIMED blocks only (taxonomy above), and only in the SAID
// lane or a FULL-width cell — the innermost cell's role wins, so a Palau nested
// said|shown pair inside a full-width wrapper counts exactly its said lane.
export function timedWordsInRow(rowNode) {
  let words = 0;
  const visit = (node, lane) => {
    const t = node.type?.name;
    if (t === 'tableCell') { const next = node.attrs?.role || 'full'; node.forEach((c) => visit(c, next)); return; }
    if (isTimedBlock(node)) {
      if (lane === 'said' || lane === 'full') words += countWords(node.textContent);
      return; // a timed block's body is counted whole — no descent needed
    }
    node.forEach((c) => visit(c, lane));
  };
  visit(rowNode, 'full');
  return words;
}

// Archive chips in ONE row: contiguous same-status directionMark[kind=archive] runs.
// Adjacent text nodes continuing the same run (a bolded word inside a chip) merge;
// a positional gap (new paragraph, other prose between) starts a new chip.
function archiveChipsInRow(rowNode) {
  let done = 0, total = 0;
  let lastEnd = -1, lastStatus = null;
  rowNode.descendants((node, pos) => {
    if (!node.isText) return true;
    const mk = (node.marks || []).find((m) => m.type?.name === 'directionMark' && m.attrs?.kind === 'archive');
    if (!mk) return true;
    const status = mk.attrs?.status || 'needed';
    if (!(pos === lastEnd && status === lastStatus)) {
      total += 1;
      if (status === 'found') done += 1;
    }
    lastEnd = pos + node.nodeSize;
    lastStatus = status;
    return true;
  });
  return { done, total };
}

// Metrics over the craft's MEMBER rows only:
//   timedWords   — spoken words (TIMED taxonomy, said/full lanes)
//   minutes      — timedWords / WORDS_PER_MINUTE (raw float; UI rounds)
//   sectionCount — contiguous member runs
//   rowCount     — member rows
//   archive only — done/total of ☐/☑ archive chips (status found vs needed) in member rows
export function workspaceMetrics(doc, roleKey) {
  const role = typeof roleKey === 'string' ? workspaceRole(roleKey) : roleKey;
  const sections = role ? scanWorkspace(doc, role) : [];
  const rows = role ? walkRows(doc) : [];
  let timedWords = 0, rowCount = 0;
  let done = 0, total = 0;
  for (const row of rows) {
    if (!rowIsMember(row.node, role)) continue;
    rowCount += 1;
    timedWords += timedWordsInRow(row.node);
    if (role.key === 'archive') {
      const a = archiveChipsInRow(row.node);
      done += a.done;
      total += a.total;
    }
  }
  const metrics = {
    timedWords,
    minutes: timedWords / WORDS_PER_MINUTE,
    sectionCount: sections.length,
    rowCount,
  };
  if (role && role.key === 'archive') { metrics.done = done; metrics.total = total; }
  return metrics;
}
