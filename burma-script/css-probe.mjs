// CSS PROBE (tbl-dim-css) — proves the FLAT TABLE CSS, in isolation from split/merge wiring.
// It injects a real SPLIT row (data-cols="2", said|shown cells) into the live editor DOM and
// reads COMPUTED styles to assert every locked-aesthetic rule actually paints:
//   1. table chrome reset      → no box-shadow, no default cell border, no zebra fill
//   2. ONE hairline only        → border-left on cell 2 only; cell 1 has none
//   3. said vs shown distinction→ shown cell gets the faint burgundy tint; said stays paper
//   4. lane labels              → ::before SAID / SHOWN, SHOWN tick is the orange accent
//   5. full-width row stays bare→ no label, no border, no tint (reads like old rack)
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:5191/burma-script/';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForTimeout(1200);

const r = await p.evaluate(() => {
  const inner = document.querySelector('.wp-rack-inner') || document.body;
  const px = (s) => parseFloat(s) || 0;
  const orangeish = (c) => { // ff5b1f-ish: high red, low-mid green, low blue
    const m = c.match(/\d+/g); if (!m) return false;
    const [r, g, bl] = m.map(Number); return r > 180 && g < 130 && bl < 90;
  };

  // Build a SPLIT row by hand from the real node classes the spine renders.
  const row = document.createElement('div');
  row.className = 'wp-trow'; row.setAttribute('data-trow', ''); row.setAttribute('data-cols', '2');
  const cells = document.createElement('div'); cells.className = 'wp-trow-cells';
  const mk = (role) => {
    const cell = document.createElement('div');
    cell.className = 'wp-tcell'; cell.setAttribute('data-tcell', ''); cell.setAttribute('data-role', role);
    const content = document.createElement('div'); content.className = 'wp-tcell-content';
    content.textContent = role + ' lane content';
    cell.appendChild(content); return cell;
  };
  const said = mk('said'), shown = mk('shown');
  cells.appendChild(said); cells.appendChild(shown); row.appendChild(cells);

  // A full-width control row.
  const frow = document.createElement('div');
  frow.className = 'wp-trow'; frow.setAttribute('data-trow', ''); frow.setAttribute('data-cols', '1');
  const fcells = document.createElement('div'); fcells.className = 'wp-trow-cells';
  const full = mk('full'); fcells.appendChild(full); frow.appendChild(fcells);

  inner.appendChild(row); inner.appendChild(frow);

  const cs = (n, pseudo) => getComputedStyle(n, pseudo || null);
  const csSaid = cs(said), csShown = cs(shown), csFull = cs(full);
  const beSaid = cs(said, '::before'), beShown = cs(shown, '::before'), beFull = cs(full, '::before');

  const out = {
    // 1. chrome reset
    saidShadow: csSaid.boxShadow, shownShadow: csShown.boxShadow,
    saidBorderL: px(csSaid.borderLeftWidth), shownBorderL: px(csShown.borderLeftWidth),
    fullBorderL: px(csFull.borderLeftWidth),
    // 3. lane tint
    saidBg: csSaid.backgroundColor, shownBg: csShown.backgroundColor, fullBg: csFull.backgroundColor,
    // 4. lane labels
    saidLabel: (beSaid.content || '').replace(/"/g, ''),
    shownLabel: (beShown.content || '').replace(/"/g, ''),
    shownLabelColorOrange: orangeish(beShown.color),
    // 5. full-width bare
    fullLabel: (beFull.content || '').replace(/"/g, ''),
  };
  inner.removeChild(row); inner.removeChild(frow);
  return out;
});
await b.close();
console.log(JSON.stringify(r, null, 2));

const checks = {
  'reset: no shadow on cells': r.saidShadow === 'none' && r.shownShadow === 'none',
  'hairline: ONLY cell-2 has border-left': r.saidBorderL === 0 && r.shownBorderL === 1 && r.fullBorderL === 0,
  'tint: shown lane tinted, said lane is paper': r.shownBg !== r.saidBg && r.shownBg !== 'rgba(0, 0, 0, 0)',
  'label: SAID + SHOWN present': /SAID/.test(r.saidLabel) && /SHOWN/.test(r.shownLabel),
  'accent: SHOWN label is the orange': r.shownLabelColorOrange === true,
  'full-width row shows NO lane label': r.fullLabel === '' || r.fullLabel === 'none',
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log((v ? 'PASS  ' : 'FAIL  ') + k); ok = ok && v; }
console.log(ok ? 'CSS PROBE: PASS' : 'CSS PROBE: FAIL');
process.exit(ok ? 0 : 1);
