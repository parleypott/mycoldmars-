// SPINE #1 probe — confirms the table spine renders: tableRow/tableCell counts > 0, the doc
// is a vertical stack of FULL-WIDTH rows (one full-width cell each), cartridge content +
// timecode chips survive inside cells. Run from inside burma-script so node resolves the
// local playwright. Usage: node spine-probe.mjs <url>
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:4178/burma-script/';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(1500);

const r = await p.evaluate(() => {
  const tables = document.querySelectorAll('.ProseMirror table.wp-script-table');
  const rows = document.querySelectorAll('.ProseMirror tr.wp-script-row');
  const cells = document.querySelectorAll('.ProseMirror td.wp-script-cell, .ProseMirror th.wp-script-cell');
  const carts = document.querySelectorAll('.ProseMirror .wp-cart');
  // cartridges that actually sit inside a table cell
  const cartsInCells = document.querySelectorAll('.ProseMirror td.wp-script-cell > .wp-cart, .ProseMirror th.wp-script-cell > .wp-cart');
  const chapters = document.querySelectorAll('.ProseMirror .wp-chapter');
  const scenes = document.querySelectorAll('.ProseMirror .wp-scene');
  // full-width check: every row's first cell spans ~the table width
  let fullWidthRows = 0, splitRows = 0;
  const table = tables[0];
  const tw = table ? table.getBoundingClientRect().width : 0;
  rows.forEach((tr) => {
    const cs = tr.querySelectorAll(':scope > td, :scope > th');
    if (cs.length === 1) {
      const cw = cs[0].getBoundingClientRect().width;
      if (tw && cw / tw > 0.9) fullWidthRows++;
    } else if (cs.length > 1) splitRows++;
  });
  // timecode chips still alive inside cells (audit's taggers)
  const tcTags = document.querySelectorAll('.ProseMirror td .wp-lcd, .ProseMirror td .wp-broll-tc, .ProseMirror td [data-tc]');
  // gridline / zebra sniff: any cell with a visible border or bg?
  let cellsWithBorder = 0, cellsWithBg = 0;
  cells.forEach((c) => {
    const st = getComputedStyle(c);
    const bw = ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].map((k) => parseFloat(st[k]) || 0);
    if (bw.some((w) => w > 0) && c.getAttribute('data-col') !== 'shown') cellsWithBorder++;
    const bg = st.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') cellsWithBg++;
  });
  let tableShadow = 'none';
  if (table) tableShadow = getComputedStyle(table).boxShadow;
  return {
    tables: tables.length, rows: rows.length, cells: cells.length,
    carts: carts.length, cartsInCells: cartsInCells.length,
    chapters: chapters.length, scenes: scenes.length,
    fullWidthRows, splitRows, tcChipsInCells: tcTags.length,
    cellsWithBorder, cellsWithBg, tableShadow, tableWidth: Math.round(tw),
  };
});
await b.close();

const PASS =
  r.tables === 1 &&
  r.rows > 0 &&
  r.cells > 0 &&
  r.cartsInCells > 0 &&
  r.cartsInCells === r.carts &&        // every cartridge lives inside a cell
  r.fullWidthRows === r.rows &&        // every row is full-width (single cell)
  r.cellsWithBorder === 0 &&           // NO spreadsheet gridlines
  r.cellsWithBg === 0 &&               // NO zebra
  r.tableShadow === 'none' &&          // flat — no shadow
  r.chapters > 0;                      // chapters present as rows

console.log(JSON.stringify({ ...r, PROBE_PASS: PASS }, null, 2));
process.exit(PASS ? 0 : 1);
