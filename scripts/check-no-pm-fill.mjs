#!/usr/bin/env node
/*
 * check-no-pm-fill.mjs — build-time lint that FORBIDS Playwright/Interceptor `.fill()` on a
 * ProseMirror surface. Origin: the 2026-07-08 data-loss incident, where `page.locator('.ProseMirror')
 * .fill('X')` REPLACED the entire live document with one character. `.fill()` on a contenteditable
 * editor is never what you want — it wipes the doc; use `pressSequentially` / real keystrokes at a
 * caret instead. This makes committing that pattern a red build, not a silent catastrophe.
 *
 * Exported `scanText(text)` is pure (returns offending lines) so a unit test can prove it.
 * Wired into `bun run build` before vite build.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// A `.fill(` call whose SAME LINE names a ProseMirror / editor surface. Deliberately narrow so
// Array.prototype.fill / TypedArray.fill / canvas fill() never trip it — only editor .fill() does.
const EDITOR_HINT = /(ProseMirror|wp-editor-content|\.wp-editor\b)/;
const FILL_CALL = /\.fill\s*\(/;

export function scanText(text) {
  const hits = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FILL_CALL.test(line) && EDITOR_HINT.test(line)) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

// Run as a script (not when imported by the test).
const isMain = process.argv[1] && process.argv[1].endsWith('check-no-pm-fill.mjs');
if (isMain) {
  let files = [];
  try {
    files = execSync('git ls-files "*.js" "*.mjs" "*.jsx" "*.ts" "*.tsx"', { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
      .filter((f) => !f.endsWith('scripts/check-no-pm-fill.mjs') && !f.endsWith('check-no-pm-fill.test.mjs'));
  } catch (e) {
    console.error('check-no-pm-fill: could not list git files —', e.message);
    process.exit(0); // never block a build over a tooling hiccup; the test still guards the logic
  }
  const offenders = [];
  for (const f of files) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const h of scanText(text)) offenders.push(`${f}:${h.line}  ${h.text}`);
  }
  if (offenders.length) {
    console.error('\n❌ .fill() on a ProseMirror editor is BANNED (it replaces the whole doc — 2026-07-08 data-loss law):');
    for (const o of offenders) console.error('   ' + o);
    console.error('\n   Use pressSequentially / real keystrokes at a caret instead.\n');
    process.exit(1);
  }
  console.log('check-no-pm-fill: clean — no .fill() on any ProseMirror surface');
}
