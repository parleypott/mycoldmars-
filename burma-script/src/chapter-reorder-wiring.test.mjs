/*
 * chapter-reorder-wiring.test.mjs — SOURCE PINS for the outline MODULAR MODE wiring in main.jsx.
 *
 * The reorder ENGINE is proved headlessly by extensions/chapter-reorder.test.mjs. This suite pins
 * the UI CONTRACT that a browser-free assert can't otherwise reach: the outline's modular mode must
 * be (a) gated off in ?read shares and when there is fewer than one movable chapter, (b) wired to
 * the pure moveChapter engine on drop (never on drag), and (c) resolve chapter indices against the
 * LIVE doc via walkChapters (never a stale outline index). If a refactor drops any of these, the
 * feature silently loses its safety posture — so we pin the strings.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, 'main.jsx'), 'utf8');

let pass = 0;
const ok = (label, cond) => { assert.ok(cond, label); pass++; };

// The engine is imported from the pure module (not re-implemented in the view).
ok('main.jsx imports moveChapter + walkChapters from the engine',
  /import\s*\{[^}]*\bmoveChapter\b[^}]*\bwalkChapters\b[^}]*\}\s*from\s*'\.\/extensions\/chapter-reorder\.js'/.test(main)
  || (/\bmoveChapter\b/.test(main) && /\bwalkChapters\b/.test(main) && /chapter-reorder\.js/.test(main)));

// OutlinePanel is handed BOTH the readOnly signal and the onReorder callback.
ok('OutlinePanel receives readOnly + onReorder props',
  /<OutlinePanel[^>]*\breadOnly=\{readOnly\}[^>]*\bonReorder=\{reorderChapters\}/.test(main)
  || (/<OutlinePanel[\s\S]{0,200}readOnly=\{readOnly\}/.test(main) && /<OutlinePanel[\s\S]{0,200}onReorder=\{reorderChapters\}/.test(main)));

// canReorder is the gate: OFF in read-only, and needs more than one chapter.
ok('modular mode is gated on !readOnly AND >1 chapter',
  /canReorder\s*=\s*!readOnly\s*&&\s*chapters\.length\s*>\s*1/.test(main));

// The REORDER toggle button and the ⠿ grip glyph both exist in the panel.
ok('REORDER toggle button present', /wp-outline-reorder/.test(main) && /REORDER/.test(main));
ok('chapter drag grip present', /wp-outline-drag-grip/.test(main) && /⠿/.test(main));

// The DOC mutates only on DROP → moveChapter, via the App handler; the drag itself dispatches
// nothing (collab-safe). reorderChapters must early-return in read-only and resolve indices live.
ok('reorderChapters early-returns in read-only', /reorderChapters\s*=\s*useCallback\(\([\s\S]{0,120}if\s*\(readOnly\)\s*return;/.test(main));
ok('reorderChapters resolves indices from the LIVE doc via walkChapters',
  /walkChapters\(doc\)\.chapters\.map\(\(c\)\s*=>\s*c\.firstBlockId\)/.test(main));
ok('reorderChapters calls moveChapter with the editor state + dispatch',
  /moveChapter\(ed\.state,\s*ed\.view\.dispatch,\s*fromIdx,\s*toIdx\)/.test(main));

// The drop handler (not a dragover/drag) is what invokes onReorder.
ok('onReorder fires from the drop handler only', /onItemDrop[\s\S]{0,220}onReorder\?\.\(/.test(main));

// ESC cancels an in-flight drag without dropping.
ok('ESC cancels an in-progress drag', /Escape[\s\S]{0,120}setDrag\(null\)[\s\S]{0,40}setDrop\(null\)/.test(main));

console.log(`chapter-reorder-wiring.test.mjs: ${pass} assertions passed`);
