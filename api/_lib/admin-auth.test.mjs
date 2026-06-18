// Tests for the admin console authorization gate (api/_lib/admin-auth.js).
//
// These functions decide who may run privileged admin actions (list/create/
// delete/set_password). A regression here is a privilege-escalation hole, and
// the logic previously lived inline in admin-users.js with ZERO coverage, with
// the ADMIN_EMAILS parse duplicated in the bootstrap path. Imports the REAL
// shipped functions. Mutation-proven (see notes below): loosening the matcher
// to a substring match, dropping the case-fold, or loosening the loopback host
// check all go RED against this suite.

import assert from 'node:assert/strict';
import { parseAdminEmails, isAdminEmail, isLoopbackHost } from './admin-auth.js';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
};

// ── parseAdminEmails ────────────────────────────────────────────────────────
t('parseAdminEmails: comma-split, trimmed, lowercased', () => {
  assert.deepEqual(
    parseAdminEmails('Johnny@Newpress.com, Admin@X.com'),
    ['johnny@newpress.com', 'admin@x.com'],
  );
});

t('parseAdminEmails: drops empty entries (trailing/double comma)', () => {
  assert.deepEqual(parseAdminEmails('a@x.com,,b@x.com,'), ['a@x.com', 'b@x.com']);
});

t('parseAdminEmails: empty / null / undefined → []', () => {
  assert.deepEqual(parseAdminEmails(''), []);
  assert.deepEqual(parseAdminEmails(null), []);
  assert.deepEqual(parseAdminEmails(undefined), []);
});

t('parseAdminEmails: whitespace-only → []', () => {
  assert.deepEqual(parseAdminEmails('   ,  , '), []);
});

t('parseAdminEmails: single entry, surrounding whitespace stripped', () => {
  assert.deepEqual(parseAdminEmails('  solo@x.com  '), ['solo@x.com']);
});

// ── isAdminEmail: the gate ──────────────────────────────────────────────────
const LIST = 'johnny@newpress.com, admin@x.com';

t('isAdminEmail: exact listed email is admin', () => {
  assert.equal(isAdminEmail('johnny@newpress.com', LIST), true);
  assert.equal(isAdminEmail('admin@x.com', LIST), true);
});

t('isAdminEmail: case-insensitive match (incoming mixed case)', () => {
  // MUTATION TARGET: drop `.toLowerCase()` in parseAdminEmails (list stays
  // mixed-case) OR drop the incoming lowercase here → these go RED.
  assert.equal(isAdminEmail('Johnny@Newpress.com', LIST), true);
  assert.equal(isAdminEmail('ADMIN@X.COM', LIST), true);
});

t('isAdminEmail: unlisted email is NOT admin', () => {
  assert.equal(isAdminEmail('stranger@elsewhere.com', LIST), false);
});

t('isAdminEmail: substring of a listed email is NOT admin (no prefix match)', () => {
  // MUTATION TARGET: change `list.includes(email)` to
  // `list.some(l => email.includes(l))` (substring) → "notadmin@x.com" would
  // wrongly contain "admin@x.com" and this assert goes RED. This is the
  // load-bearing privilege-escalation guard.
  assert.equal(isAdminEmail('notadmin@x.com', LIST), false);
  assert.equal(isAdminEmail('admin@x.com.evil.com', LIST), false);
  assert.equal(isAdminEmail('xjohnny@newpress.com', LIST), false);
});

t('isAdminEmail: empty admin list → nobody is admin (fail-closed)', () => {
  assert.equal(isAdminEmail('johnny@newpress.com', ''), false);
  assert.equal(isAdminEmail('johnny@newpress.com', null), false);
  assert.equal(isAdminEmail('johnny@newpress.com', undefined), false);
});

t('isAdminEmail: missing / falsy email → false (fail-closed)', () => {
  assert.equal(isAdminEmail('', LIST), false);
  assert.equal(isAdminEmail(null, LIST), false);
  assert.equal(isAdminEmail(undefined, LIST), false);
});

t('isAdminEmail: reads process.env.ADMIN_EMAILS when raw omitted', () => {
  const prev = process.env.ADMIN_EMAILS;
  try {
    process.env.ADMIN_EMAILS = 'env-admin@x.com';
    assert.equal(isAdminEmail('env-admin@x.com'), true);
    assert.equal(isAdminEmail('someone-else@x.com'), false);
    delete process.env.ADMIN_EMAILS;
    assert.equal(isAdminEmail('env-admin@x.com'), false); // unset → fail-closed
  } finally {
    if (prev === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prev;
  }
});

t('isAdminEmail: whitespace around list entries does not block a match', () => {
  assert.equal(isAdminEmail('admin@x.com', '  admin@x.com  '), true);
});

// ── isLoopbackHost: the dev-bypass host check ───────────────────────────────
t('isLoopbackHost: localhost and 127.0.0.1 are loopback', () => {
  assert.equal(isLoopbackHost('http://localhost:3000/api/admin-users'), true);
  assert.equal(isLoopbackHost('http://127.0.0.1/api/admin-users'), true);
  assert.equal(isLoopbackHost('https://localhost/x'), true);
});

t('isLoopbackHost: a real host that merely CONTAINS "localhost" is NOT loopback', () => {
  // MUTATION TARGET: change `=== 'localhost'` to `.includes('localhost')` →
  // "notlocalhost.evil.com" / "localhost.attacker.com" go RED. Loosening this
  // is what re-opens the spoofed-Host dev-bypass the handler comment warns about.
  assert.equal(isLoopbackHost('https://notlocalhost.evil.com/x'), false);
  assert.equal(isLoopbackHost('https://localhost.attacker.com/x'), false);
  assert.equal(isLoopbackHost('https://127.0.0.1.evil.com/x'), false);
});

t('isLoopbackHost: production-style host → false', () => {
  assert.equal(isLoopbackHost('https://mycoldmars.vercel.app/api/admin-users'), false);
});

t('isLoopbackHost: unparseable / missing URL → false (fail-closed, no throw)', () => {
  assert.equal(isLoopbackHost('not a url'), false);
  assert.equal(isLoopbackHost(''), false);
  assert.equal(isLoopbackHost(null), false);
  assert.equal(isLoopbackHost(undefined), false);
});

// ── Inline RED proof: the substring-match bug the gate must never have ───────
t('RED proof: a substring matcher would wrongly admit a non-admin', () => {
  const buggyIsAdmin = (email, raw) => {
    if (!email) return false;
    const list = parseAdminEmails(raw);
    if (!list.length) return false;
    return list.some(l => String(email).toLowerCase().includes(l)); // BUG
  };
  // The real gate rejects this; the buggy substring matcher admits it.
  assert.equal(isAdminEmail('notadmin@x.com', LIST), false);
  assert.equal(buggyIsAdmin('notadmin@x.com', LIST), true);
});

console.log(`admin-auth: ${pass} passed`);
