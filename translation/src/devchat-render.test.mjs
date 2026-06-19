// Locks the devchat untrusted-message render boundary. /api/devchat-respond is
// a PUBLIC anonymous endpoint, so every field of a message row (body, sender,
// metadata.images[].url, id) is attacker-controllable and gets rendered into
// the operator's DOM via innerHTML. messageToHtml + its three guards are the
// only thing standing between a hostile message and stored XSS / a live
// javascript:/data: href. This test imports the REAL shipped functions and is
// mutation-proven: break any guard and a case below goes RED.
//
// Run: node translation/src/devchat-render.test.mjs   (or via `bun run test`)

import { escDc, safeImageUrl, senderLabel, messageToHtml } from './devchat-render.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); } }
function eq(a, b, name) { ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── escDc: the HTML-entity encoder ──────────────────────────────────────────
eq(escDc('<script>'), '&lt;script&gt;', 'escDc < and >');
eq(escDc('a & b'), 'a &amp; b', 'escDc ampersand');
eq(escDc('"quote"'), '&quot;quote&quot;', 'escDc double quote');
eq(escDc("it's"), 'it&#39;s', 'escDc single quote');
eq(escDc('plain text'), 'plain text', 'escDc safe passthrough');
eq(escDc(null), '', 'escDc null -> empty');
eq(escDc(undefined), '', 'escDc undefined -> empty');
eq(escDc(0), '0', 'escDc number 0 (not dropped)');
// the full breakout set in one go — none survive
ok(!/[<>"']/.test(escDc(`<img src=x onerror="alert(1)">'`)), 'escDc neutralizes a full breakout payload');
// ampersand escaped first so existing entities are not double-decoded-ambiguous
eq(escDc('&lt;'), '&amp;lt;', 'escDc escapes a literal &lt; (ampersand first)');

// ── safeImageUrl: scheme whitelist ──────────────────────────────────────────
eq(safeImageUrl('https://x.com/a.png'), 'https://x.com/a.png', 'safeImageUrl https allowed');
eq(safeImageUrl('http://x.com/a.png'), 'http://x.com/a.png', 'safeImageUrl http allowed');
eq(safeImageUrl('javascript:alert(1)'), null, 'safeImageUrl javascript: rejected');
eq(safeImageUrl('JavaScript:alert(1)'), null, 'safeImageUrl JavaScript: (case) rejected');
eq(safeImageUrl('data:text/html,<script>alert(1)</script>'), null, 'safeImageUrl data: rejected');
eq(safeImageUrl('vbscript:msgbox(1)'), null, 'safeImageUrl vbscript: rejected');
eq(safeImageUrl('file:///etc/passwd'), null, 'safeImageUrl file: rejected');
eq(safeImageUrl('not a url'), null, 'safeImageUrl garbage rejected');
eq(safeImageUrl(''), null, 'safeImageUrl empty rejected');
eq(safeImageUrl(null), null, 'safeImageUrl null rejected (no throw)');
eq(safeImageUrl(undefined), null, 'safeImageUrl undefined rejected (no throw)');

// ── senderLabel: friendly role mapping (always escDc'd by caller) ───────────
eq(senderLabel('user'), 'you', 'senderLabel user');
eq(senderLabel('assistant'), 'parley', 'senderLabel assistant');
eq(senderLabel('agent'), 'fixer', 'senderLabel agent');
eq(senderLabel('<b>evil</b>'), '<b>evil</b>', 'senderLabel passes unknown through raw (caller must escape)');

// ── messageToHtml: the end-to-end boundary ──────────────────────────────────
// A hostile body must not yield live markup.
{
  const html = messageToHtml({ sender: 'user', body: '<script>alert(document.cookie)</script>', id: '1' });
  ok(!html.includes('<script>'), 'messageToHtml: hostile body has no live <script>');
  ok(html.includes('&lt;script&gt;'), 'messageToHtml: hostile body is entity-encoded');
}
// A hostile sender (used in a class attr AND a label) must not break out.
{
  const html = messageToHtml({ sender: '" onload="alert(1)', body: 'hi', id: '1' });
  ok(!html.includes('onload="alert(1)"') && !/devchat-msg--" /.test(html), 'messageToHtml: hostile sender cannot break the class attr');
  ok(html.includes('&quot;'), 'messageToHtml: hostile sender quote encoded');
}
// A hostile id must not break out of the data-msg-id attr.
{
  const html = messageToHtml({ sender: 'user', body: 'x', id: '"><img src=x onerror=alert(1)>' });
  ok(!html.includes('<img src=x onerror=alert(1)>'), 'messageToHtml: hostile id cannot inject an <img>');
}
// A javascript: image url must be dropped entirely (no href, no img).
{
  const html = messageToHtml({ sender: 'user', body: '', metadata: { images: [{ url: 'javascript:alert(1)' }] } });
  ok(!html.includes('javascript:'), 'messageToHtml: javascript: image url dropped');
  ok(!html.includes('<img'), 'messageToHtml: no <img> emitted for unsafe url');
}
// A data:text/html image url must be dropped entirely.
{
  const html = messageToHtml({ sender: 'user', body: '', metadata: { images: [{ url: 'data:text/html,<script>1</script>' }] } });
  ok(!html.includes('data:text/html'), 'messageToHtml: data: image url dropped');
}
// A safe https image survives and is rendered as an <img>/<a>.
{
  const html = messageToHtml({ sender: 'agent', body: 'see this', metadata: { images: [{ url: 'https://cdn.example.com/a.png' }] } });
  ok(html.includes('https://cdn.example.com/a.png'), 'messageToHtml: safe https image rendered');
  ok(html.includes('<img'), 'messageToHtml: safe image emits an <img>');
  ok(html.includes('rel="noopener noreferrer"'), 'messageToHtml: external link carries noopener');
  ok(html.includes('fixer'), 'messageToHtml: agent sender labeled "fixer"');
}
// Mixed image list: safe survives, unsafe dropped.
{
  const html = messageToHtml({ sender: 'user', body: '', metadata: { images: [
    { url: 'javascript:alert(1)' },
    { url: 'https://ok.com/p.jpg' },
  ] } });
  ok(html.includes('https://ok.com/p.jpg') && !html.includes('javascript:'), 'messageToHtml: mixed list keeps safe, drops unsafe');
}
// No images / no body: still renders the shell, no crash.
{
  const html = messageToHtml({ sender: 'assistant' });
  ok(html.includes('parley'), 'messageToHtml: minimal row renders sender label');
  ok(!html.includes('devchat-msg-images'), 'messageToHtml: no images block when none present');
  ok(!html.includes('devchat-msg-body'), 'messageToHtml: no body block when body empty');
}
// Newlines in body become <br> (after escaping).
{
  const html = messageToHtml({ sender: 'user', body: 'line1\nline2', id: '1' });
  ok(html.includes('line1<br>line2'), 'messageToHtml: body newlines -> <br>');
}

// ── RED proof: the OLD-style url passthrough (no scheme whitelist) WOULD leak.
// Reconstruct the pre-guard behavior (encode url but keep any scheme) and show
// a javascript: href survives it — proving safeImageUrl is load-bearing.
{
  const naiveHref = (u) => `<a href="${escDc(u)}">`; // no scheme check
  const leaked = naiveHref('javascript:alert(1)');
  ok(leaked.includes('javascript:alert(1)'), 'RED proof: naive (no-whitelist) render leaks a live javascript: href');
  // the shipped path drops it:
  const guarded = messageToHtml({ sender: 'user', body: '', metadata: { images: [{ url: 'javascript:alert(1)' }] } });
  ok(!guarded.includes('javascript:'), 'GREEN: shipped messageToHtml does not leak it');
}

console.log(`\ndevchat-render: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
