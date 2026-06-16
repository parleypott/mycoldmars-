// SPINE PROBE — confirm the doc renders as a vertical stack of full-width ROWS:
// tableRow/tableCell counts > 0, full-width rows = cols 1, cartridge chips intact.
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:5191/burma-script/';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const rows = document.querySelectorAll('.wp-trow, [data-trow]');
  const cells = document.querySelectorAll('.wp-tcell, [data-tcell]');
  const carts = document.querySelectorAll('.wp-cart');
  const cartsInCells = document.querySelectorAll('.wp-tcell .wp-cart, [data-tcell] .wp-cart');
  // every row should currently be a full-width single cell
  let oneCellRows = 0, multiCellRows = 0;
  rows.forEach((row) => {
    const c = row.querySelectorAll(':scope > .wp-trow-cells > .wp-tcell, :scope > [data-tcell]').length
      || row.querySelectorAll('.wp-tcell').length;
    if (c <= 1) oneCellRows++; else multiCellRows++;
  });
  // a full-width cell should span ~the device width (sanity: >70% of inner width)
  const firstRow = rows[0];
  const firstCell = firstRow?.querySelector('.wp-tcell');
  const inner = document.querySelector('.wp-rack-inner');
  const fullWidth = firstCell && inner
    ? (firstCell.getBoundingClientRect().width / inner.getBoundingClientRect().width) : 0;
  // chips still alive inside cells
  const tcChips = document.querySelectorAll('.wp-tcell [data-tc], .wp-tcell .wp-tc-tag').length
    || document.querySelectorAll('[data-tc]').length;
  const tkChips = document.querySelectorAll('.wp-tcell [data-tk], .wp-tcell .wp-tk, [data-tk]').length;
  return {
    rows: rows.length, cells: cells.length, carts: carts.length, cartsInCells: cartsInCells.length,
    oneCellRows, multiCellRows, fullWidthRatio: +fullWidth.toFixed(2), tcChips, tkChips,
  };
});
await b.close();
console.log(JSON.stringify(r, null, 2));
const ok = r.rows > 0 && r.cells > 0 && r.cartsInCells > 0 && r.cartsInCells === r.carts && r.fullWidthRatio > 0.7 && r.multiCellRows === 0;
console.log(ok ? 'SPINE PROBE: PASS' : 'SPINE PROBE: FAIL');
process.exit(ok ? 0 : 1);
