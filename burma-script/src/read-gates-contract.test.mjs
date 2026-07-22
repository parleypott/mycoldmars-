/**
 * READ-GATE CONTRACT — what MOUNTS vs what STAYS HIDDEN in a ?read share (vector:
 * workspaces-in-read). Both lists in ONE pinning test.
 *
 * A ?read share is for Johnny's TEAMMATES. The v1 cut excluded ROLES + WORKSPACES from it
 * ("worth a stage-5 revisit"); this reverses that. But the share must stay STRUCTURALLY
 * write-incapable — enabling the read-safe lens/cutout chrome must not drag any WRITE surface
 * onto the reader's page. The mount decisions live in main.jsx JSX (Preact, not unit-mountable
 * headless), so — exactly like roles-lens-contract.test.mjs pins the CSS/JS lens contract by
 * scanning source — this scans main.jsx and asserts each feature's render site is gated the way
 * the contract requires. If a future edit re-gates workspaces behind !readOnly, or drops the
 * !readOnly guard off a write surface, this breaks.
 *
 *   MOUNTS IN READ (read-safe: decoration-only paint / view-local state, zero doc writes):
 *     RoleHub · masthead WorkspacesMenu · StickyHeader · WorkspaceHub · ScriptMap host ·
 *     enterWorkspace (no readOnly early-return) · ?ws= deep-link effect (no readOnly gate)
 *
 *   STAYS HIDDEN IN READ (owner chrome / write surfaces — still !readOnly-gated):
 *     ModeToggle · ShareToggle (masthead AND sticky) · TipsToggle · Exports dock ·
 *     INSERT / EXPORT / RESET footer · RecoveryBanner · CloudHistoryPanel · SaveStatus
 *
 * Run: bun src/read-gates-contract.test.mjs   (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stickyHeaderVisible } from './sticky-header.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(HERE, 'main.jsx'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// A render site "<Foo" that is NOT immediately wrapped by a `{!readOnly &&` (optionally `(`).
const gatedBefore = (tag) => new RegExp(`\\{!readOnly &&\\s*\\(?\\s*<${tag}\\b`);
const present = (tag) => new RegExp(`<${tag}\\b`);

// ── MOUNTS IN READ — present, and NOT gated by !readOnly at the render site ───────────────────
ok('RoleHub mounts in read (already enabled — the crew lens on ?read links)', () => {
  assert.ok(present('RoleHub').test(main), 'RoleHub is rendered');
  assert.ok(!gatedBefore('RoleHub').test(main), 'RoleHub is NOT wrapped in {!readOnly && …}');
});

ok('masthead WorkspacesMenu mounts in read', () => {
  assert.ok(present('WorkspacesMenu').test(main), 'WorkspacesMenu is rendered');
  assert.ok(!gatedBefore('WorkspacesMenu').test(main), 'no WorkspacesMenu render site is !readOnly-gated');
  assert.ok(/WORKSPACES mounts in \?read shares too/.test(main), 'the read-safe intent is documented at the site');
});

ok('StickyHeader mounts in read (carries workspaces; drops share internally)', () => {
  assert.ok(present('StickyHeader').test(main), 'StickyHeader is rendered');
  assert.ok(!gatedBefore('StickyHeader').test(main), 'StickyHeader mount is NOT !readOnly-gated');
});

ok('WorkspaceHub + ScriptMap host are reachable in read (gated on ws state, not readOnly)', () => {
  assert.ok(/\{wsRole && <WorkspaceHub\b/.test(main), 'WorkspaceHub gates on wsRole (reachable once ws is set in read)');
  assert.ok(/ws === WS_MAP_KEY && \(/.test(main), 'the SCRIPT MAP host gates on the ws key, not readOnly');
});

ok('enterWorkspace has NO readOnly early-return (a read viewer can enter a workspace)', () => {
  assert.ok(!/if \(readOnly\) return;\s*\n\s*const role = workspaceRole\(key\)/.test(main),
    'enterWorkspace must not early-return on readOnly');
});

ok('the ?ws= deep-link effect runs in read (?read&ws=3d lands direct)', () => {
  assert.ok(!/if \(readOnly\) return undefined;\s*\n\s*let target = null/.test(main),
    'the deep-link effect must not early-return on readOnly');
  assert.ok(/Runs in \?read shares too/.test(main), 'the deep-link comment documents read composition');
});

// ── STAYS HIDDEN IN READ — every WRITE / owner surface is still !readOnly-gated ────────────────
ok('ModeToggle stays hidden in read (a reader has no edit mode to arm)', () => {
  assert.ok(/\{!readOnly && <ModeToggle\b/.test(main));
});

ok('ShareToggle stays hidden in read — BOTH the masthead and the sticky strip', () => {
  assert.ok(/\{!readOnly && <ShareToggle project=\{EPISODE\.id\} \/>\}/.test(main), 'masthead share gated');
  assert.ok(/\{!readOnly && <ShareToggle project=\{project\} \/>\}/.test(main), 'sticky-strip share gated');
  // Every ShareToggle render site is !readOnly-gated — count the tags vs the gated tags.
  const all = (main.match(/<ShareToggle\b/g) || []).length;
  const gated = (main.match(/\{!readOnly && <ShareToggle\b/g) || []).length;
  assert.equal(all, gated, 'no ShareToggle is rendered ungated');
});

ok('TipsToggle stays hidden in read (editing affordances)', () => {
  assert.ok(/\{!readOnly && <TipsToggle\b/.test(main));
});

ok('Exports dock stays hidden in read', () => {
  assert.ok(/\{!readOnly && <Exports\b/.test(main));
});

ok('INSERT / EXPORT / RESET footer controls stay hidden in read', () => {
  assert.ok(/\{!readOnly && editUi && \(\s*\n\s*<button class="wp-insert"/.test(main), 'INSERT gated');
  assert.ok(/\{!readOnly && <button class="wp-foot-btn" onClick=\{openExports\}/.test(main), 'EXPORT gated');
  assert.ok(/\{!readOnly && editUi && <button class="wp-foot-btn" onClick=\{resetDoc\}/.test(main), 'RESET gated');
});

ok('backup surfaces stay hidden in read (RecoveryBanner + CloudHistoryPanel)', () => {
  assert.ok(/\{!readOnly && showAdminBackups\(\) && <RecoveryBanner\b/.test(main));
  assert.ok(/\{!readOnly && showAdminBackups\(\) && <CloudHistoryPanel\b/.test(main));
});

ok('read shows the frozen ReadOnlyBadge, never the SaveStatus pill', () => {
  assert.ok(/\{readOnly \? <ReadOnlyBadge \/> : <SaveStatus \/>\}/.test(main));
});

// ── The sticky strip's pure rule no longer force-hides on a share ─────────────────────────────
ok('stickyHeaderVisible: readOnly is NOT a hide gate (share carries workspaces)', () => {
  assert.equal(stickyHeaderVisible({ mastheadVisible: false, readOnly: true, wsActive: false, chFocusActive: false }), true,
    'a scrolled-past read share still shows the strip');
  assert.equal(stickyHeaderVisible({ mastheadVisible: false, readOnly: true, wsActive: true, chFocusActive: false }), false,
    'an active workspace still yields the top edge, share or not');
});

console.log(`\nread-gates-contract.test.mjs — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
