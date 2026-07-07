// Tests for the self-signup domain gate (api/_lib/newpress-domain.js).
//
// This predicate decides who may mint their own account, so every mutation
// that loosens it is a privilege hole: a suffix match admits evil-newpress.com,
// a substring match admits newpress.com.evil.com, a missing anchor admits
// trailing junk, a case-sensitive compare locks out JOHNNY@NEWPRESS.COM.
// The same rule is enforced server-side by the Supabase before-user-created
// hook (public.hook_restrict_signup_to_newpress) — these tests lock the JS
// half; the SQL half applies the identical lower/trim/exact-regex logic.

import assert from 'node:assert/strict';
import { isNewpressEmail, SIGNUP_DOMAIN } from './newpress-domain.js';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
};

t('the exported domain is the one the copy promises', () => {
  assert.equal(SIGNUP_DOMAIN, 'newpress.com');
});

t('accepts a plain @newpress.com address', () => {
  assert.equal(isNewpressEmail('johnny@newpress.com'), true);
  assert.equal(isNewpressEmail('a@newpress.com'), true);
  assert.equal(isNewpressEmail('first.last+tag@newpress.com'), true);
});

t('case-insensitive — users shout, the gate should not care', () => {
  assert.equal(isNewpressEmail('JOHNNY@NEWPRESS.COM'), true);
  assert.equal(isNewpressEmail('Johnny@Newpress.Com'), true);
});

t('surrounding whitespace is trimmed, not fatal', () => {
  assert.equal(isNewpressEmail('  johnny@newpress.com  '), true);
  assert.equal(isNewpressEmail('\tjohnny@newpress.com\n'), true);
});

t('INTERNAL whitespace is fatal — no smuggling spaces past the domain check', () => {
  assert.equal(isNewpressEmail('johnny @newpress.com'), false);
  assert.equal(isNewpressEmail('johnny@new press.com'), false);
  assert.equal(isNewpressEmail('johnny@newpress .com'), false);
});

t('lookalike domains fail closed', () => {
  assert.equal(isNewpressEmail('a@evil-newpress.com'), false);
  assert.equal(isNewpressEmail('a@newpress-evil.com'), false);
  assert.equal(isNewpressEmail('a@newpress.com.evil.com'), false);
  assert.equal(isNewpressEmail('a@xnewpress.com'), false);
  assert.equal(isNewpressEmail('a@newpress.comx'), false);
  assert.equal(isNewpressEmail('a@newpress.co'), false);
  assert.equal(isNewpressEmail('a@newpress.com.'), false);
});

t('subdomains are NOT the domain — mail.newpress.com is refused', () => {
  assert.equal(isNewpressEmail('a@mail.newpress.com'), false);
  assert.equal(isNewpressEmail('a@sub.newpress.com'), false);
});

t('exactly one @ — multi-@ addresses are refused, whichever side matches', () => {
  assert.equal(isNewpressEmail('a@evil.com@newpress.com'), false);
  assert.equal(isNewpressEmail('a@newpress.com@evil.com'), false);
  assert.equal(isNewpressEmail('a@@newpress.com'), false);
});

t('degenerate shapes are refused', () => {
  assert.equal(isNewpressEmail('newpress.com'), false);      // no @ at all
  assert.equal(isNewpressEmail('@newpress.com'), false);     // empty local part
  assert.equal(isNewpressEmail('a@'), false);
  assert.equal(isNewpressEmail(''), false);
  assert.equal(isNewpressEmail('   '), false);
});

t('non-strings are refused, never thrown on', () => {
  assert.equal(isNewpressEmail(null), false);
  assert.equal(isNewpressEmail(undefined), false);
  assert.equal(isNewpressEmail(42), false);
  assert.equal(isNewpressEmail({ email: 'a@newpress.com' }), false);
  assert.equal(isNewpressEmail(['a@newpress.com']), false);
});

t('the regex dot is escaped — newpressXcom must not match', () => {
  assert.equal(isNewpressEmail('a@newpressxcom'), false);
  assert.equal(isNewpressEmail('a@newpress_com'), false);
});

console.log(`newpress-domain: ${pass} passed${process.exitCode ? ' (with failures)' : ''}`);
