// Locks the zanyplans media-resolution core (media.js) — the helpers every
// space's render depends on. getMediaType picks the DOM element (video vs img);
// getMediaForSpace turns a slug into the render list or a placeholder grid.
//
// Hand-rolled assert style to match the repo runner (bun <file>, no node:test).
//
// MUTATION-PROVEN (hand-verified before commit): drop the gif branch → RED;
// drop getMediaType's String() guard back to `filename.split` → RED on nullish;
// change the placeholder count from 12 → RED.

import { getMediaType, getMediaForSpace, pickMediaKind } from './media.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${g}\n  want: ${w}`); }
};
const ok = (cond, msg) => {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
};

// ── getMediaType: video extensions (case-insensitive — manifests carry .MP4) ──
eq(getMediaType('clip.mp4'), 'video', 'mp4 -> video');
eq(getMediaType('clip.webm'), 'video', 'webm -> video');
eq(getMediaType('CLIP.MP4'), 'video', 'uppercase MP4 -> video');
eq(getMediaType('a.b.c.WEBM'), 'video', 'multi-dot WEBM -> video');

// ── getMediaType: gif is its own type, NOT video and NOT image ──
eq(getMediaType('loop.gif'), 'gif', 'gif -> gif');
eq(getMediaType('LOOP.GIF'), 'gif', 'uppercase GIF -> gif');
ok(getMediaType('loop.gif') !== 'image', 'gif branch present (sentinel: drop it -> image)');

// ── getMediaType: stills and unknowns fall through to image ──
eq(getMediaType('still.png'), 'image', 'png -> image');
eq(getMediaType('still.jpg'), 'image', 'jpg -> image');
eq(getMediaType('still.jpeg'), 'image', 'jpeg -> image');
eq(getMediaType('noext'), 'image', 'no extension -> image');
eq(getMediaType(''), 'image', 'empty string -> image');

// ── getMediaType: never THROWS on nullish input (the String() guard) ──
// A render-time crash on undefined is a white screen; the guard must hold.
ok((() => { try { return getMediaType(undefined) === 'image'; } catch { return false; } })(),
   'undefined filename -> image, no throw');
ok((() => { try { return getMediaType(null) === 'image'; } catch { return false; } })(),
   'null filename -> image, no throw');

// ── getMediaForSpace: real manifest slug yields src/type/label per file ──
{
  const items = getMediaForSpace('taiwan-hong-kong');
  ok(items.length > 0, 'taiwan-hong-kong has manifest media');
  let allGood = true;
  for (const m of items) {
    if (!m.src.startsWith('/zanyplans/spaces/taiwan-hong-kong/')) allGood = false;
    if (!['video', 'gif', 'image'].includes(m.type)) allGood = false;
    if (typeof m.label !== 'string') allGood = false;
    if (m.type === 'placeholder') allGood = false;
  }
  ok(allGood, 'every manifest item: space-scoped src, real render type, string label, never placeholder');
  const first = items[0];
  eq(first.src, `/zanyplans/spaces/taiwan-hong-kong/${first.label}`, 'src ends in the actual filename (no doubled/empty segment)');
  const mp4 = items.find(m => m.label.toLowerCase().endsWith('.mp4'));
  if (mp4) eq(mp4.type, 'video', 'an .mp4 manifest entry resolves to video (getMediaType wiring)');
  const png = items.find(m => m.label.toLowerCase().endsWith('.png'));
  if (png) eq(png.type, 'image', 'a .png manifest entry resolves to image');
}

// ── getMediaForSpace: empty/unknown slug yields exactly 12 placeholders ──
for (const slug of ['void', 'memories', 'no-such-space']) {
  const items = getMediaForSpace(slug);
  eq(items.length, 12, `${slug} -> exactly 12 placeholder tiles`);
  let allGood = true;
  items.forEach((m, i) => {
    if (m.src !== null) allGood = false;
    if (m.type !== 'placeholder') allGood = false;
    if (m.label !== `${slug.toUpperCase()}_${String(i).padStart(3, '0')}.DAT`) allGood = false;
    if (!/^hsl\(/.test(m.color)) allGood = false;
  });
  ok(allGood, `${slug}: null src, placeholder type, zero-padded .DAT label, hsl color`);
}

// ── getMediaForSpace: placeholder hue stays inside the per-space palette band ──
{
  const hueOf = (c) => Number(c.match(/^hsl\(([-\d.]+)/)[1]);
  const voidHues = getMediaForSpace('void').map(m => hueOf(m.color));
  ok(voidHues.every(h => h >= 220 && h < 260), 'void hues within [220,260)');
  const memHues = getMediaForSpace('memories').map(m => hueOf(m.color));
  eq(memHues[0], 0, 'first placeholder sits at the palette floor (memories -> 0)');
  ok(memHues.every(h => h >= 0 && h < 30), 'memories hues within [0,30)');
  const wheelHues = getMediaForSpace('mystery').map(m => hueOf(m.color));
  ok(wheelHues.every(h => h >= 0 && h < 360), 'unknown slug uses the full wheel [0,360)');
}

// ── pickMediaKind: the SHARED video/image/placeholder element decision ──
// (was duplicated + divergent in grid-collage.js and mac-window.js). Every media
// object getMediaForSpace produces must resolve the same way both render builders
// used to agree on, and the two former edge divergences are now pinned to one rule.

// Canonical render-list shapes (the only inputs that reach this live):
eq(pickMediaKind({ type: 'video', src: '/x.mp4', label: 'x' }), 'video', 'video+src -> video');
eq(pickMediaKind({ type: 'image', src: '/x.png', label: 'x' }), 'image', 'image+src -> image');
eq(pickMediaKind({ type: 'gif', src: '/x.gif', label: 'x' }), 'image', 'gif+src -> image (both builders agreed)');
eq(pickMediaKind({ type: 'placeholder', src: null, color: 'hsl(0,0%,0%)' }), 'placeholder', 'placeholder/null-src -> placeholder');

// Sentinel: a real video element must NOT be served for a still image, and vice
// versa — a wrong verdict ships a broken <video> for a JPG or a frozen <img> for a clip.
ok(pickMediaKind({ type: 'video', src: '/x.mp4' }) !== 'image', 'video sentinel: clip never renders as <img>');
ok(pickMediaKind({ type: 'image', src: '/x.png' }) !== 'video', 'image sentinel: still never renders as <video>');

// A video TYPE with no src can't be a <video> (empty-src element) — falls to placeholder.
eq(pickMediaKind({ type: 'video', src: null }), 'placeholder', 'video type but null src -> placeholder (no empty <video>)');
eq(pickMediaKind({ type: 'video', src: '' }), 'placeholder', 'video type but empty src -> placeholder');

// The former divergence, now pinned to ONE rule:
//  - unknown type WITH a src -> image (was placeholder in mac-window, image in grid-collage).
eq(pickMediaKind({ type: 'sprite', src: '/x.bin' }), 'image', 'unknown type + src -> image (show the media)');
eq(pickMediaKind({ src: '/x.bin' }), 'image', 'missing type + src -> image');
//  - explicit placeholder type WITH a stray src -> placeholder (was image in grid-collage).
eq(pickMediaKind({ type: 'placeholder', src: '/x.bin' }), 'placeholder', 'placeholder type wins even with a stray src');

// Never THROWS on garbage — a render-time crash here is a white screen.
ok((() => { try { return pickMediaKind(null) === 'placeholder'; } catch { return false; } })(),
   'null media -> placeholder, no throw');
ok((() => { try { return pickMediaKind(undefined) === 'placeholder'; } catch { return false; } })(),
   'undefined media -> placeholder, no throw');

// Cross-check: every item getMediaForSpace emits resolves to a real render kind.
for (const slug of ['taiwan-hong-kong', 'void', 'night-market']) {
  for (const m of getMediaForSpace(slug)) {
    const kind = pickMediaKind(m);
    ok(['video', 'image', 'placeholder'].includes(kind), `${slug}: ${m.label} -> a real render kind (${kind})`);
    // src-bearing manifest media must never collapse to a blank placeholder tile.
    if (m.src) ok(kind !== 'placeholder', `${slug}: src-bearing ${m.label} never renders as a blank tile`);
  }
}

console.log(`\nmedia: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
