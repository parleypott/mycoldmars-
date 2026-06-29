#!/usr/bin/env bun
//
// sort-comparators.mjs — the shared extraction core for the repo's `.sort()`
// comparator gates (find-bool-sort-comparator.mjs, find-nan-sort-comparator.mjs).
//
// WHY THIS EXISTS
// Both gates need the SAME machinery: find every `.sort(` call, pull its
// paren-balanced (string-aware) argument, read the inline-arrow body, and walk
// the repo's real authored source. Only the *classifier* (boolean-returning vs
// inline-date-parse) and the docstring/labels differ. That extraction core was
// COPY-PASTED byte-for-byte into both scripts — exactly the divergent-weaker-twin
// setup the loop hunts everywhere else, now in the loop's OWN tooling: a fix to
// the paren-balancer (or adding `.toSorted(`, or a new string-escape edge) would
// have to land in two files or one would silently rot. Worse, the two copies had
// already drifted on SCAN_DIRS — find-bool scanned 12 dirs while find-nan scanned
// 20, so the boolean gate was BLIND to commentbank / prawn / todo / research /
// growth / queen-scarlet-school (QSS alone carries ~20 sort comparators). This
// module is the single source of truth: one extractor, one scan surface, both
// gates import it. Each gate keeps only its own classifier + self-test fixtures.
//
// Pure + dependency-free; the gates layer their verdict semantics on top.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root: this file lives in scripts/, so ../ is the root. Both gates live in
// the same scripts/ dir, so they share this exact root.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Scan surface (the UNIFIED set — never let the two gates drift again) ───────
// Real authored source across every dir that carries user-facing sorts. The wide
// set is the union of what both gates historically scanned; the narrower bool-gate
// list was a latent coverage gap, not a deliberate scope choice.
export const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'commentbank', 'prawn', 'research', 'todo', 'democracy', 'growth',
  'views-growth', 'queen-scarlet-school',
];

export const EXT = /\.(js|mjs|ts|html)$/;

// Base skip shared by both gates: tests (a gate that flagged its own fixtures is
// useless), minified files, vendored bundles, node_modules. Each gate ORs in a
// skip for its OWN filename (its docstring + self-test embed intentional bad
// comparators that would otherwise self-trip the gate) via buildSkip().
export const BASE_SKIP_SOURCE = '\\.test\\.|\\.spec\\.|\\.min\\.|node_modules|/assets/index-|\\bdist\\b';

// The sort-gate family's own files (+ ledgers): each carries intentional sort
// fixtures in its docstring/self-test that would self-trip a SIBLING gate (e.g.
// find-bare-sort's boolean-comparator scope fixture trips find-bool). No sort
// gate should scan another's fixtures, so all three skip the whole family. One
// source of truth: add a new sort gate's file here and every sibling skips it.
export const SORT_GATE_FILES =
  'find-bool-sort-comparator\\.mjs|find-nan-sort-comparator\\.mjs|find-bare-sort\\.mjs|bare-sort-triage\\.tsv';

// Compose the base skip with a gate's own self-file marker (e.g. its basename),
// so each gate excludes itself without re-stating the shared exclusions. Pass
// SORT_GATE_FILES to also exclude the sibling sort gates' fixture files.
export function buildSkip(selfMarker) {
  return new RegExp(`(${BASE_SKIP_SOURCE}|${selfMarker})`);
}

function walk(dir, out, skip) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, out, skip);
    } else if (EXT.test(name) && !skip.test(p)) {
      out.push(p);
    }
  }
}

// Every real source file under the unified scan surface, minus the gate's skips.
export function sourceFiles(skip, scanDirs = SCAN_DIRS, root = ROOT) {
  const out = [];
  for (const d of scanDirs) walk(join(root, d), out, skip);
  return out.sort();
}

// ── Comment stripping (offset-preserving) ─────────────────────────────────────
// Overwrite `//` line comments and `/* */` block comments with spaces, leaving
// every byte offset (and line number) intact, so a `.sort(` written inside a
// docstring (this repo documents the very patterns its gates hunt) can't be
// mistaken for a real call site. String/template aware. Pragmatic, not a full
// lexer: a `//` inside a regex literal could be misread as a comment, which can
// only DROP a site (never invent one) — the safe direction. Shared so the sort
// gates that need it can't drift on the logic. (find-bare-sort uses this; the
// comparator gates skip their own files instead, so they don't call it.)
export function stripComments(src) {
  const out = src.split('');
  let inStr = null, prev = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      prev = c === '\\' && prev === '\\' ? '' : c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; prev = c; continue; }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      i--; prev = ''; continue;
    }
    if (c === '/' && n === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i++; }
      prev = ''; continue;
    }
    prev = c;
  }
  return out.join('');
}

// ── Extraction (paren-balanced, string-aware) ──────────────────────────────────
// Find each `.sort(` and yield {arg, index} for its balanced argument list, so
// nested calls like `Math.abs(...)` / `new Date(...)` stay intact.
export function* sortCalls(src) {
  const re = /\.sort\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1; // position of the '('
    let depth = 0, i = open, inStr = null, prev = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (c === inStr && prev !== '\\') inStr = null;
      } else if (c === '"' || c === "'" || c === '`') {
        inStr = c;
      } else if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
      prev = c === '\\' && prev === '\\' ? '' : c;
    }
    if (depth === 0) {
      yield { arg: src.slice(open + 1, i), index: m.index };
    }
  }
}

// Given the inside of `.sort( ... )`, return the arrow body string, or a marker:
//   { kind: 'arrow', body }  — inline arrow expression: classify it
//   { kind: 'block' }        — arrow with a { } block body: out of scope
//   { kind: 'named' }        — no `=>` at top level (function ref / fn expr): out of scope
export function comparatorBody(arg) {
  // Locate the FIRST top-level `=>` (skip ones nested inside parens, e.g. a default).
  let depth = 0, inStr = null, prev = '';
  for (let i = 0; i < arg.length - 1; i++) {
    const c = arg[i];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      prev = c; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; prev = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '=' && arg[i + 1] === '>') {
      const body = arg.slice(i + 2).trim();
      if (body.startsWith('{')) return { kind: 'block' };
      return { kind: 'arrow', body };
    }
    prev = c;
  }
  return { kind: 'named' };
}

export function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

// Classify one source string → [{verdict, line, body}] for inline arrows, plus
// skipped sites when verbose. `classifyBody` is the gate-specific verdict fn.
export function classifySource(src, classifyBody, { verbose = false } = {}) {
  const rows = [];
  for (const { arg, index } of sortCalls(src)) {
    const cb = comparatorBody(arg);
    if (cb.kind === 'arrow') {
      rows.push({ verdict: classifyBody(cb.body), line: lineOf(src, index), body: cb.body.replace(/\s+/g, ' ').slice(0, 70) });
    } else if (verbose) {
      rows.push({ verdict: 'SKIP', line: lineOf(src, index), body: `(${cb.kind})` });
    }
  }
  return rows;
}

export function classifyFile(path, classifyBody, opts) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return []; }
  return classifySource(src, classifyBody, opts).map((r) => ({ ...r, path }));
}
