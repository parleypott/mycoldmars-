/*
 * chapter-masthead-regal.test.mjs — the Edwardian title-page restyle contract (browser-free).
 *
 * Guards the REGAL chapter masthead: centered composition, Baskerville-class title serif, spaced
 * small caps, one hairline ornament, centered genre eyebrow + italic deck — AND that the whole
 * feature stays pure CSS (chapter-frames.js dispatches no automatic transactions -> COLLAB-safe).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'doctrine.css'), 'utf8');
const framesJs = readFileSync(join(here, 'extensions', 'chapter-frames.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.error('  ✗', name, extra != null ? '— ' + extra : ''); } }

const rule = (sel) => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}')); return m ? m[0] : ''; };

// ── title serif token ───────────────────────────────────────────────────────────────────────
ok('token: --ep-title-serif defined on Spectral', /--ep-title-serif\s*:\s*'Spectral'/.test(css));

// ── centered composition ──────────────────────────────────────────────────────────────────────
const body = rule('.wp-chframe-first .wp-chapter .wp-cart-body');
ok('body: masthead is centered', /text-align:\s*center/.test(body), body);
ok('dash: old left eyebrow dash retired', /\.wp-cart-body::before\s*\{\s*content:\s*none/.test(css));

// ── the TITLE ──────────────────────────────────────────────────────────────────────────────────
const title = rule('.wp-chframe-first .wp-chapter .wp-body > p:first-child');
ok('title: uses Baskerville-class title serif', /var\(--ep-title-serif\)/.test(title), title);
ok('title: spaced SMALL CAPS', /font-variant-caps:\s*small-caps/.test(title), title);
ok('title: has letter-spacing (tracking)', /letter-spacing:\s*0?\.0[3-9]\d*em/.test(title), title);
ok('title: no synthetic bold (weight <= 500)', /font-weight:\s*[45]00/.test(title) && !/font-weight:\s*[67]00/.test(title), title);
ok('title: centered (margin auto)', /margin:\s*0\s+auto/.test(title), title);

// ── the single hairline ORNAMENT ────────────────────────────────────────────────────────────────
const orn = rule('.wp-chframe-first .wp-chapter .wp-body > p:first-child::after');
ok('ornament: hairline rule present (1px, centered)', /height:\s*1px/.test(orn) && /margin:[^;]*auto/.test(orn), orn);

// ── the SUBTITLE deck ────────────────────────────────────────────────────────────────────────────
const sub = rule('.wp-chframe-first .wp-chapter .wp-body > p:not(:first-child)');
ok('subtitle: centered (margin auto)', /margin:\s*0\s+auto/.test(sub), sub);
ok('subtitle: stays italic', /font-style:\s*italic/.test(sub), sub);

// ── the GENRE eyebrow ────────────────────────────────────────────────────────────────────────────
const tag = rule('.wp-chframe-first .wp-chapter .wp-ch-tag');
ok('eyebrow: centered top strip', /text-align:\s*center/.test(tag) && /left:\s*0/.test(tag), tag);
ok('eyebrow: heavily tracked (spaced caps)', /letter-spacing:\s*\.3\d*em/.test(tag), tag);

// ── COLLAB LOOP LAW — the masthead source must dispatch NO automatic transactions ───────────────
ok('collab: chapter-frames.js has no appendTransaction', !/appendTransaction/.test(framesJs));
ok('collab: chapter-frames.js runs no normalizer/dispatch', !/\.dispatch\(|addKeyboardShortcuts|handleTextInput/.test(framesJs));

console.log(`chapter-masthead-regal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
