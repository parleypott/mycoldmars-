/**
 * IMAGE UPLOAD — 413 SELF-HEALING contract (2026-07-22, "adding images fails — http 413 — the
 * picture was NOT added").
 *
 * TWO LAYERS the fix guarantees, proven here headlessly against a mocked fetch (the dev API proxy
 * doesn't run in the test env, so the 413 is mocked at the fetch layer — exactly the boundary the
 * fix keys on):
 *   1. ROUTE CONSERVATIVELY — a photo whose base64 JSON envelope could clear the platform's ~4.5MB
 *      body gate takes the signed road up front (covered in image-drop.test.mjs / image-video.test.mjs).
 *   2. SELF-HEAL — if the base64 edge road 413s ANYWAY, runMediaUpload silently re-runs the SAME
 *      bytes down the signed road. The caller only sees a failure when BOTH roads fail. Dedupe
 *      (contentHash) rides on both roads.
 *
 * Run: bun burma-script/src/extensions/image-drop-413-fallback.test.mjs
 */
import assert from 'node:assert/strict';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';
import { runMediaUpload } from './image-drop.js';

setEpisode(BURMA);

// Bun has no FileReader; fileToBase64() reads via readAsDataURL. Minimal polyfill over arrayBuffer.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsDataURL(file) {
      file.arrayBuffer()
        .then((buf) => { this.result = `data:${file.type};base64,${Buffer.from(buf).toString('base64')}`; this.onload && this.onload(); })
        .catch((e) => { this.onerror && this.onerror(e); });
    }
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const savedFetch = globalThis.fetch;
function installFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    let body = null; try { body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null; } catch {}
    calls.push({ url: u, method: opts.method || 'GET', body });
    for (const [match, handler] of routes) if (u.includes(match)) return handler(opts, body);
    return new Response('not mocked', { status: 500 });
  };
  return calls;
}

let pass = 0;
const file = (bytes, type = 'image/jpeg') => new File([new Uint8Array(bytes).fill(1)], 'photo.jpg', { type });

async function run() {
  // ── 1: base64 road 413 → AUTO-heal onto the signed road → success, no error surfaced ────────
  {
    const calls = installFetch([
      // Platform-style 413: rejected BEFORE the function, non-JSON body, status 413.
      ['/api/script-image-upload', () => new Response('Payload Too Large', { status: 413 })],
      ['/api/script-image-sign', () => json(200, { ok: true, uploadUrl: 'https://storage.test/put/obj', mime: 'image/jpeg', publicUrl: 'https://cdn.test/final.jpg' })],
      ['storage.test', () => new Response('', { status: 200 })],
    ]);
    const out = await runMediaUpload(file(100 * 1024), 'img_heal');   // small → base64 route first
    assert.equal(out.url, 'https://cdn.test/final.jpg', 'healed via the signed road');
    assert.ok(!out.error, 'no error surfaced when the fallback succeeded');
    const seq = calls.map((c) => c.url.replace('https://', '').split('/').slice(-1)[0] || c.url);
    assert.ok(calls[0].url.includes('script-image-upload'), 'base64 road tried first');
    assert.ok(calls.some((c) => c.url.includes('script-image-sign')), 'then the signed road');
    assert.ok(calls.some((c) => c.url.includes('storage.test') && c.method === 'PUT'), 'bytes PUT to storage');
    // DEDUPE intact on BOTH roads: a contentHash accompanies the base64 body AND the sign body.
    assert.ok(HEX64.test(calls.find((c) => c.url.includes('upload')).body.contentHash), 'base64 body carries contentHash');
    assert.ok(HEX64.test(calls.find((c) => c.url.includes('sign')).body.contentHash), 'sign body carries contentHash');
    pass++; console.log('  ✓ base64 413 auto-heals onto the signed road; no error surfaced');
  }

  // ── 2: BOTH roads fail → an error is returned (the caller surfaces the toast), never a url ──
  {
    installFetch([
      ['/api/script-image-upload', () => new Response('Payload Too Large', { status: 413 })],
      ['/api/script-image-sign', () => json(500, { error: 'sign exploded' })],
    ]);
    const out = await runMediaUpload(file(100 * 1024), 'img_bothfail');
    assert.ok(!out.url, 'no url when both roads fail');
    assert.ok(out.error, 'an error is returned for the caller to toast');
    pass++; console.log('  ✓ both roads fail → error returned (toast is the caller\'s job), no url');
  }

  // ── 3: base64 road SUCCEEDS → the signed road is never touched (no needless fallback) ───────
  {
    const calls = installFetch([
      ['/api/script-image-upload', () => json(200, { ok: true, url: 'https://cdn.test/small.jpg' })],
      ['/api/script-image-sign', () => { throw new Error('signed road must not run on a base64 success'); }],
    ]);
    const out = await runMediaUpload(file(100 * 1024), 'img_ok');
    assert.equal(out.url, 'https://cdn.test/small.jpg');
    assert.ok(!calls.some((c) => c.url.includes('sign')), 'signed road never called');
    pass++; console.log('  ✓ base64 success does not trigger a fallback');
  }

  // ── 4: a NON-413 base64 failure is surfaced as-is (no fallback — a real failure isn\'t a 413) ─
  {
    const calls = installFetch([
      ['/api/script-image-upload', () => json(400, { error: 'bad_request' })],
      ['/api/script-image-sign', () => { throw new Error('must not fall back on a non-413 error'); }],
    ]);
    const out = await runMediaUpload(file(100 * 1024), 'img_400');
    assert.ok(!out.url);
    assert.match(String(out.error), /bad_request|http 400/);
    assert.ok(!calls.some((c) => c.url.includes('sign')), 'no fallback on a non-413 error');
    pass++; console.log('  ✓ a non-413 base64 error surfaces as-is (no fallback)');
  }

  // ── 5: an oversized photo goes STRAIGHT to signed (base64 never tried) — the routing layer ──
  {
    const calls = installFetch([
      ['/api/script-image-upload', () => { throw new Error('base64 must not run for an oversized photo'); }],
      ['/api/script-image-sign', () => json(200, { ok: true, uploadUrl: 'https://storage.test/put/big', mime: 'image/jpeg', publicUrl: 'https://cdn.test/big.jpg' })],
      ['storage.test', () => new Response('', { status: 200 })],
    ]);
    const out = await runMediaUpload(file(5 * 1024 * 1024), 'img_big');   // 5MB → envelope over ceiling → signed
    assert.equal(out.url, 'https://cdn.test/big.jpg');
    assert.ok(!calls.some((c) => c.url.includes('upload') && c.url.includes('script-image-upload')), 'base64 road never touched');
    pass++; console.log('  ✓ oversized photo routes straight to signed (no base64 round-trip)');
  }

  globalThis.fetch = savedFetch;
  console.log(`image-drop-413-fallback: ${pass} passed, 0 failed`);
}

await run();
