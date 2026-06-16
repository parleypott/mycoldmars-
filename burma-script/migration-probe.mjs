// SACRED MIGRATION probe — legacy flat persisted doc migrates losslessly to the table spine:
// backs up first, validates round-trip, renders as a table, drops not one word/timecode/fill.
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4178/burma-script/';
const b = await chromium.launch();
const p = await b.newPage();

// 1) load + force an autosave so a real table doc lands in localStorage.
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(1200);
await p.click('.ProseMirror', { timeout: 5000 }).catch(() => {});
await p.keyboard.type(' ');           // a no-op edit to trigger the 400ms autosave
await p.waitForTimeout(900);

// 2) read the saved TABLE doc, unwrap to a LEGACY flat list, inject a unique {tk}/{fc} FILL,
//    write it back as the persisted doc (simulating a doc saved before the table spine).
const setRes = await p.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('wp01_burma_doc_v1') || '{}');
  const flat = [];
  for (const n of saved.content || []) {
    if (n.type === 'table') for (const row of n.content || []) for (const cell of row.content || []) for (const c of cell.content || []) flat.push(c);
    else flat.push(n);
  }
  const vo = flat.find((x) => x.type === 'voBlock');
  if (vo?.content?.[0]) vo.content[0].content = [{ type: 'text', text: 'UNIQUE_FILL_SENTINEL_42 a writer answer.' }];
  localStorage.setItem('wp01_burma_doc_v1', JSON.stringify({ type: 'doc', content: flat }));
  localStorage.removeItem('wp01_burma_doc_v1__pre_table_backup');
  return { flatLen: flat.length };
});

// 3) reload — seedDoc must detect legacy-flat, migrate to table, back up the original.
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const tables = document.querySelectorAll('.ProseMirror table.wp-script-table').length;
  const rows = document.querySelectorAll('.ProseMirror tr.wp-script-row').length;
  const hasFill = (document.querySelector('.ProseMirror')?.innerText || '').includes('UNIQUE_FILL_SENTINEL_42');
  const backup = localStorage.getItem('wp01_burma_doc_v1__pre_table_backup');
  let backupHasFill = false, backupIsFlat = false;
  if (backup) {
    backupHasFill = backup.includes('UNIQUE_FILL_SENTINEL_42');
    const bd = JSON.parse(backup);
    backupIsFlat = !(bd.content || []).some((n) => n.type === 'table');
  }
  return { tables, rows, hasFill, backupExists: !!backup, backupHasFill, backupIsFlat };
});
await b.close();
const PASS = r.tables === 1 && r.rows > 0 && r.hasFill && r.backupExists && r.backupHasFill && r.backupIsFlat;
console.log(JSON.stringify({ setFlatLen: setRes.flatLen, ...r, MIGRATION_PASS: PASS }, null, 2));
process.exit(PASS ? 0 : 1);
