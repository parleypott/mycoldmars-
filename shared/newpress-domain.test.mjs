// Tests for the self-signup domain gate (shared/newpress-domain.js).
//
// isNewpressEmail is the ONE JS definition of "may this address mint its own
// account". scripts-library/src/auth.js flips supabase `shouldCreateUser` on it,
// and the server-side Postgres hook (public.hook_restrict_signup_to_newpress)
// mirrors the same rule as the real wall. This predicate had ZERO coverage: a
// loosening here (substring domain match, unescaped dot, dropped anchor, missing
// case-fold, no type guard) quietly widens who can self-register. This suite
// imports the REAL shipped predicate and is mutation-proven — every plausible
// weakening below turns it RED:
//   • remove `^`               → "evil@evil.com a@newpress.com" passes (tail match)
//   • remove `$`               → "a@newpress.com.evil.com" passes (prefix match)
//   • unescape the dot (`\.`)  → "a@newpressXcom" passes
//   • drop the trim/lowercase  → "A@NEWPRESS.COM" / " a@newpress.com " fails valid
//   • drop the typeof guard    → null/number throw instead of returning false
//   • `+`→`*` on local part    → "@newpress.com" (empty local) passes

import assert from 'node:assert/strict';
import { SIGNUP_DOMAIN, isNewpressEmail } from './newpress-domain.js';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
};

// ── the constant ────────────────────────────────────────────────────────────
t('SIGNUP_DOMAIN is the exact newpress domain', () => {
  assert.equal(SIGNUP_DOMAIN, 'newpress.com');
});

// ── accepts real newpress addresses ───────────────────────────────────────────
t('plain address accepted', () => {
  assert.equal(isNewpressEmail('johnny@newpress.com'), true);
});

t('case-insensitive — pins the toLowerCase()', () => {
  assert.equal(isNewpressEmail('Johnny@Newpress.com'), true);
  assert.equal(isNewpressEmail('A@NEWPRESS.COM'), true);
});

t('surrounding whitespace stripped — pins the trim()', () => {
  assert.equal(isNewpressEmail('  johnny@newpress.com  '), true);
  assert.equal(isNewpressEmail('johnny@newpress.com\n'), true);
  assert.equal(isNewpressEmail('\tjohnny@newpress.com'), true);
});

t('rich-but-valid local parts accepted (plus-tag, dots, symbols)', () => {
  assert.equal(isNewpressEmail('johnny+library@newpress.com'), true);
  assert.equal(isNewpressEmail('johnny.w.harris@newpress.com'), true);
  assert.equal(isNewpressEmail("o'brien_1@newpress.com"), true);
});

// ── fails closed on lookalikes ────────────────────────────────────────────────
t('suffix lookalike rejected — pins the whole-domain match', () => {
  assert.equal(isNewpressEmail('evil@evil-newpress.com'), false);
  assert.equal(isNewpressEmail('evil@evilnewpress.com'), false);
});

t('trailing-domain lookalike rejected — pins the $ anchor', () => {
  assert.equal(isNewpressEmail('a@newpress.com.evil.com'), false);
  assert.equal(isNewpressEmail('a@newpress.company'), false);
});

t('subdomain rejected — sub.newpress.com is not newpress.com', () => {
  assert.equal(isNewpressEmail('a@sub.newpress.com'), false);
  assert.equal(isNewpressEmail('a@mail.newpress.com'), false);
});

t('leading-token lookalike rejected — pins the ^ anchor', () => {
  // A valid suffix exists ("a@newpress.com") but the whole trimmed string must
  // be one token; the embedded space + prefix must fail the anchored match.
  assert.equal(isNewpressEmail('evil@evil.com a@newpress.com'), false);
});

t('dot is literal — pins the escaped \\. in the regex', () => {
  assert.equal(isNewpressEmail('a@newpressXcom'), false);
  assert.equal(isNewpressEmail('a@newpressacom'), false);
});

t('wrong TLD rejected', () => {
  assert.equal(isNewpressEmail('a@newpress.co'), false);
  assert.equal(isNewpressEmail('a@newpress.org'), false);
  assert.equal(isNewpressEmail('a@newpress.net'), false);
});

t('empty local part rejected — pins the + (one-or-more) quantifier', () => {
  assert.equal(isNewpressEmail('@newpress.com'), false);
});

t('double @ rejected', () => {
  assert.equal(isNewpressEmail('a@@newpress.com'), false);
  assert.equal(isNewpressEmail('a@b@newpress.com'), false);
});

t('embedded whitespace rejected — pins [^\\s@] excluding \\s', () => {
  assert.equal(isNewpressEmail('a b@newpress.com'), false);
  assert.equal(isNewpressEmail('a@ newpress.com'), false);
  assert.equal(isNewpressEmail('a@newpress .com'), false);
  assert.equal(isNewpressEmail('a b@newpress.com'), false); // NBSP
});

t('non-newpress domains rejected', () => {
  assert.equal(isNewpressEmail('someone@gmail.com'), false);
  assert.equal(isNewpressEmail('johnnywharris@gmail.com'), false);
});

// ── type guard — fails closed on non-strings ──────────────────────────────────
t('non-string input returns false, never throws — pins the typeof guard', () => {
  assert.equal(isNewpressEmail(null), false);
  assert.equal(isNewpressEmail(undefined), false);
  assert.equal(isNewpressEmail(42), false);
  assert.equal(isNewpressEmail({}), false);
  assert.equal(isNewpressEmail(['a@newpress.com']), false);
  assert.equal(isNewpressEmail(''), false);
});

console.log(`newpress-domain: ${pass} passed, ${process.exitCode ? 'SOME FAILED' : '0 failed'}`);
