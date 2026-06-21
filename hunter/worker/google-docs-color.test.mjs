// Locks the Hunter Script Copilot's Google Docs color cores — the functions that
// turn Docs API rgbColor objects into the hex/colored-run/color-name signals the
// copilot trains on ("colors mean something in JH's scripts").
//
// Real bug fixed here (case-mismatch class): extractRunStyle skips black/near-black
// foreground text as "the default", but rgbToHex returns UPPERCASE hex while the
// skip set listed a LOWERCASE '#1a1a1a' — so soft-black body text (rgb ~26,26,26 ->
// #1A1A1A) never matched the skip and leaked in as a `color` (a "colored run"),
// inflating countColoredRuns/stats.coloredRunCount with noise.
//
// Imports the REAL shipped functions (no mirror) so the lock can't drift.

import {
  rgbToHex,
  hexToRgb,
  normalizeColor,
  approximateColorName,
  extractRunStyle,
} from './google-docs-parser.js';

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) { if (cond) passed++; else { failed++; fails.push(name); } }
function eq(name, a, b) { ok(name, a === b); if (a !== b && fails[fails.length - 1] === name) fails[fails.length - 1] = `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`; }

const fg = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return { foregroundColor: { color: { rgbColor: { red: r / 255, green: g / 255, blue: b / 255 } } } };
};
const bg = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return { backgroundColor: { color: { rgbColor: { red: r / 255, green: g / 255, blue: b / 255 } } } };
};

// ── inline RED proof: the OLD lowercase skip set never matched rgbToHex's uppercase output ──
{
  const hex = rgbToHex({ red: 0.10196, green: 0.10196, blue: 0.10196 });
  eq('RED-proof: rgbToHex(near-black) is uppercase #1A1A1A', hex, '#1A1A1A');
  // old code: `hex !== '#000000' && hex !== '#1a1a1a'` -> true && true -> color RECORDED (bug)
  const oldWouldRecord = hex !== '#000000' && hex !== '#1a1a1a';
  ok('RED-proof: old lowercase check would have RECORDED near-black as a color', oldWouldRecord === true);
  // shipped fix: near-black is skipped
  const style = extractRunStyle(fg('#1A1A1A'));
  ok('FIX: near-black foreground is NOT recorded as a color', style.color === undefined);
}

// ── extractRunStyle: the near-black skip (the fix) ──
ok('pure black #000000 foreground skipped', extractRunStyle(fg('#000000')).color === undefined);
ok('near-black #1A1A1A foreground skipped', extractRunStyle(fg('#1A1A1A')).color === undefined);
// a genuinely meaningful color IS recorded
eq('purple #9900FF foreground recorded', extractRunStyle(fg('#9900FF')).color, '#9900FF');
eq('red #FF0000 foreground recorded', extractRunStyle(fg('#FF0000')).color, '#FF0000');
// a non-skip dark gray (e.g. #333333) is still recorded — the skip list is exact-match by design
eq('dark gray #333333 still recorded (not in skip set)', extractRunStyle(fg('#333333')).color, '#333333');

// ── extractRunStyle: highlight (background) is always the load-bearing signal ──
eq('highlight recorded from background', extractRunStyle(bg('#FFFF00')).highlight, '#FFFF00');
ok('highlight + bold combine', (() => { const s = extractRunStyle({ ...bg('#9900FF'), bold: true }); return s.highlight === '#9900FF' && s.bold === true; })());
ok('bold/italic/underline/strikethrough flags', (() => {
  const s = extractRunStyle({ bold: true, italic: true, underline: true, strikethrough: true });
  return s.bold && s.italic && s.underline && s.strikethrough;
})());
ok('empty textStyle -> empty object', Object.keys(extractRunStyle({})).length === 0);
ok('default Arial font not recorded', extractRunStyle({ weightedFontFamily: { fontFamily: 'Arial' } }).font === undefined);
eq('non-default font recorded', extractRunStyle({ weightedFontFamily: { fontFamily: 'Georgia' } }).font, 'Georgia');
eq('fontSize recorded', extractRunStyle({ fontSize: { magnitude: 14 } }).fontSize, 14);
// black HIGHLIGHT is NOT skipped (only foreground default is) — a black highlight is a real signal
eq('black highlight is NOT skipped (background is always meaningful)', extractRunStyle(bg('#000000')).highlight, '#000000');

// ── rgbToHex: 0-1 -> 0-255, rounding, zero-pad, uppercase ──
eq('rgbToHex pure red', rgbToHex({ red: 1, green: 0, blue: 0 }), '#FF0000');
eq('rgbToHex white', rgbToHex({ red: 1, green: 1, blue: 1 }), '#FFFFFF');
eq('rgbToHex black', rgbToHex({ red: 0, green: 0, blue: 0 }), '#000000');
eq('rgbToHex rounds 0.5*255=127.5 -> 128 (0x80)', rgbToHex({ red: 0.5, green: 0, blue: 0 }), '#800000');
eq('rgbToHex zero-pads single-digit channel (15 -> 0F)', rgbToHex({ red: 15 / 255, green: 0, blue: 0 }), '#0F0000');
eq('rgbToHex output is uppercase', rgbToHex({ red: 0.6, green: 0.6, blue: 0.6 }), '#999999');
eq('rgbToHex missing channels default to 0', rgbToHex({ red: 1 }), '#FF0000');
eq('rgbToHex empty object -> black', rgbToHex({}), '#000000');

// ── hexToRgb: parse + round-trip with rgbToHex ──
ok('hexToRgb #FF0000', (() => { const [r, g, b] = hexToRgb('#FF0000'); return r === 255 && g === 0 && b === 0; })());
ok('hexToRgb lowercase #00ff00 (parseInt case-insensitive)', (() => { const [r, g, b] = hexToRgb('#00ff00'); return r === 0 && g === 255 && b === 0; })());
ok('hexToRgb without leading #', (() => { const [r, g, b] = hexToRgb('0000FF'); return r === 0 && g === 0 && b === 255; })());
ok('round-trip rgbToHex(hexToRgb) identity', (() => {
  for (const h of ['#9900FF', '#FF6600', '#1A1A1A', '#808080', '#000000', '#FFFFFF']) {
    const [r, g, b] = hexToRgb(h);
    if (rgbToHex({ red: r / 255, green: g / 255, blue: b / 255 }) !== h) return false;
  }
  return true;
})());

// ── normalizeColor: merge within distance 30, keep distinct beyond ──
eq('normalizeColor merges a near-identical color', normalizeColor('#9900FF', ['#9901FE']), '#9901FE');
eq('normalizeColor keeps a clearly-distinct color', normalizeColor('#FF0000', ['#0000FF']), '#FF0000');
eq('normalizeColor returns itself when no existing colors', normalizeColor('#FF0000', []), '#FF0000');
ok('normalizeColor boundary: distance just over 30 stays distinct', (() => {
  // #000000 vs #140000 -> distance = 20 (<30, merges); #1F0000 -> 31 (>30, distinct)
  return normalizeColor('#1F0000', ['#000000']) === '#1F0000' && normalizeColor('#140000', ['#000000']) === '#000000';
})());

// ── approximateColorName: known colors named, far colors fall through to hex ──
eq('approximateColorName exact purple', approximateColorName('#9900FF'), 'PURPLE');
eq('approximateColorName exact red', approximateColorName('#FF0000'), 'RED');
eq('approximateColorName exact yellow', approximateColorName('#FFFF00'), 'YELLOW');
eq('approximateColorName near-purple snaps to PURPLE', approximateColorName('#9905FA'), 'PURPLE');
eq('approximateColorName far/unmatched color -> hex passthrough', approximateColorName('#808080'), '#808080');

// ── summary ──
console.log(`google-docs-color: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
