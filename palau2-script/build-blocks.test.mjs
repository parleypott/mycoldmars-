// First coverage for palau2-script/build-blocks.mjs — the Palau V2 blocks assembler
// that turns the raw PDF-parse (palau2-blocks-raw.json) into the engine block format
// (palau2-blocks.json) for Johnny's flagship "The Human Element" Palau V2 script.
//
// This is a DISTINCT builder from the tested V1 palau-script/build-blocks.mjs — it had
// ZERO coverage, yet it does three load-bearing transforms whose silent breakage would
// corrupt the seeded script:
//   • convertBlock — image notes → real image atoms (correct /palau2/img/ src, caption
//     stripped of the [[IMAGE: …]] marker, imageKind normalized) and direction-tag
//     stripping ({{animation}} → purple flavor; other {{tokens}} just stripped so the
//     synthetic tag never leaks into Johnny's verbatim copy).
//   • repairSandwichedImages — pair-integrity repair: a pair-less image sandwiched
//     BETWEEN the two members of one pair adopts that pairId + the preceding member's
//     lane + half width, so a two-column A/V pair doesn't silently split into full-width
//     rows (the real pair_27 case: Premiere-timeline + transcript screenshots between a
//     said on-cam and its shown b-roll).
//   • convert — orchestration + fixed title, empty-safe on a doc with no blocks.
//
// Importing is side-effect-free: build-blocks.mjs guards its file→file main() behind a
// direct-invocation check, so the pure transforms load cleanly headless.
//
// Run: bun palau2-script/build-blocks.test.mjs
import { convertBlock, repairSandwichedImages, convert } from './build-blocks.mjs';

let passed = 0, failed = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error(`FAIL: ${msg}`); } }

// ── convertBlock: IMAGE notes → image atoms ────────────────────────────────────
{
  const img = convertBlock({
    id: 'note_9', type: 'note', imageRef: 'shot-a.png', imageKind: 'shot',
    text: '[[IMAGE: shot-a.png]] wide of the reef',
    lane: 'shown', width: 'half', pairId: 'pair_9', flavor: 'purple',
  });
  eq(img.type, 'image', 'image note becomes an image block');
  // Load-bearing: the src is the public /palau2/img/ path built from imageRef (NOT the text).
  eq(img.imageSrc, '/palau2/img/shot-a.png', 'imageSrc is /palau2/img/ + imageRef');
  // Caption strips the [[IMAGE: …]] marker and trims — the marker must never render as alt text.
  eq(img.imageAlt, 'wide of the reef', 'imageAlt strips the [[IMAGE: …]] marker');
  eq(img.imageKind, 'shot', 'imageKind passes through for a shot');
  // The paired-column attrs must ride along or a shown-lane image loses its column.
  eq(img.lane, 'shown', 'image carries lane');
  eq(img.width, 'half', 'image carries width');
  eq(img.pairId, 'pair_9', 'image carries pairId');
  eq(img.flavor, 'purple', 'image carries an existing flavor');
  // The image atom must NOT leak the raw note fields (text / imageRef / type:note).
  ok(!('text' in img), 'image atom drops the raw note text');
  ok(!('imageRef' in img), 'image atom drops imageRef');
}

// imageKind normalization: only "inspo" stays inspo; anything else (incl. missing) → "shot".
eq(convertBlock({ id: 'i', imageRef: 'x.png', imageKind: 'inspo', text: '' }).imageKind, 'inspo', 'inspo imageKind preserved');
eq(convertBlock({ id: 'i', imageRef: 'x.png', text: '' }).imageKind, 'shot', 'missing imageKind defaults to shot');
eq(convertBlock({ id: 'i', imageRef: 'x.png', imageKind: 'weird', text: '' }).imageKind, 'shot', 'unknown imageKind falls back to shot');
// A bare image with no pair attrs must not invent them.
{
  const bare = convertBlock({ id: 'i', imageRef: 'x.png', text: '[[IMAGE: x.png]]' });
  ok(!('lane' in bare) && !('pairId' in bare) && !('width' in bare), 'unpaired image invents no pair attrs');
  eq(bare.imageAlt, '', 'marker-only caption strips to empty');
}

// ── convertBlock: DIRECTION tags ──────────────────────────────────────────────
{
  const anim = convertBlock({ id: 'd', type: 'broll', text: '{{animation}}the border tightens', lane: 'shown' });
  eq(anim.text, 'the border tightens', '{{animation}} token stripped from verbatim text');
  eq(anim.flavor, 'purple', '{{animation}} stamps the purple ANIMATION flavor');
}
{
  // {{animation}} must NOT override an already-set flavor.
  const anim2 = convertBlock({ id: 'd', text: '{{animation}}x', flavor: 'pink' });
  eq(anim2.text, 'x', 'token stripped even when a flavor exists');
  eq(anim2.flavor, 'pink', 'existing flavor is not clobbered by {{animation}}');
}
{
  // Non-animation tags: stripped, but NO flavor added.
  const broll = convertBlock({ id: 'd', type: 'broll', text: '{{broll}}drone over the atoll' });
  eq(broll.text, 'drone over the atoll', '{{broll}} token stripped');
  ok(!('flavor' in broll), '{{broll}} adds no flavor');
  eq(convertBlock({ id: 'd', text: '{{oncam}}to camera' }).text, 'to camera', '{{oncam}} stripped');
  eq(convertBlock({ id: 'd', text: '{{3d}}globe spins' }).text, 'globe spins', '{{3d}} stripped');
  eq(convertBlock({ id: 'd', text: '{{direction}}cut to black' }).text, 'cut to black', '{{direction}} stripped');
}
// A plain block with no imageRef and no tag passes through verbatim.
eq(convertBlock({ id: 'v', type: 'vo', text: 'we flew to Palau' }).text, 'we flew to Palau', 'untagged text is verbatim');
// imageRef takes precedence over a text tag (image branch is checked first).
eq(convertBlock({ id: 'p', imageRef: 'y.png', text: '{{animation}}caption' }).type, 'image', 'imageRef wins over a text tag');

// ── repairSandwichedImages: pair integrity ────────────────────────────────────
{
  // The real pair_27 shape: two pair-less images sit between a said on-cam and its shown b-roll.
  const blocks = [
    { type: 'oncam', pairId: 'p27', lane: 'said' },
    { type: 'image', imageSrc: '/palau2/img/timeline.png' },
    { type: 'image', imageSrc: '/palau2/img/transcript.png' },
    { type: 'broll', pairId: 'p27', lane: 'shown' },
  ];
  const out = repairSandwichedImages(blocks);
  for (const idx of [1, 2]) {
    eq(out[idx].pairId, 'p27', `sandwiched image ${idx} adopts the enclosing pairId`);
    eq(out[idx].lane, 'said', `sandwiched image ${idx} adopts the PRECEDING member's lane`);
    eq(out[idx].width, 'half', `sandwiched image ${idx} becomes half width`);
  }
}
{
  // lane defaults to 'said' when the preceding member carries no lane.
  const out = repairSandwichedImages([
    { type: 'sot', pairId: 'pX' },
    { type: 'image' },
    { type: 'sot', pairId: 'pX' },
  ]);
  eq(out[1].lane, 'said', 'lane defaults to said when prev has none');
  eq(out[1].pairId, 'pX', 'still absorbed when prev has no lane');
}
{
  // NOT sandwiched (the following block is not a same-pair member) → untouched.
  const out = repairSandwichedImages([
    { type: 'vo', pairId: 'pA' },
    { type: 'image' },
    { type: 'vo' },
  ]);
  ok(!('pairId' in out[1]), 'a non-sandwiched image is left alone');
}
{
  // An image that already has a pairId is never re-homed.
  const out = repairSandwichedImages([
    { type: 'oncam', pairId: 'p1', lane: 'said' },
    { type: 'image', pairId: 'pOTHER', lane: 'shown' },
    { type: 'broll', pairId: 'p1', lane: 'shown' },
  ]);
  eq(out[1].pairId, 'pOTHER', 'an already-paired image keeps its own pairId');
}

// ── convert: orchestration ────────────────────────────────────────────────────
{
  const doc = convert({ blocks: [
    { id: 'n', imageRef: 'a.png', imageKind: 'shot', text: '[[IMAGE: a.png]] cap' },
    { id: 'd', text: '{{animation}}move' },
  ] });
  eq(doc.title, 'Palau V2 — The Human Element', 'convert stamps the V2 title');
  eq(doc.blocks.length, 2, 'convert maps every raw block');
  eq(doc.blocks[0].imageSrc, '/palau2/img/a.png', 'convert runs convertBlock on each block');
  eq(doc.blocks[1].flavor, 'purple', 'convert applies the animation flavor');
}
eq(convert({}).blocks.length, 0, 'convert is empty-safe on a doc with no blocks');

// ── Mutation guards (why each assertion is load-bearing) ──
// • Drop the '/palau2/img/' prefix in convertBlock → imageSrc assertions go RED (broken images).
// • Drop the IMAGE_TEXT_RE caption strip → imageAlt shows the raw "[[IMAGE: …]]" marker → RED.
// • Change `=== 'inspo' ? 'inspo' : 'shot'` → the inspo/shot normalization assertions go RED.
// • Stop carrying lane/width/pairId onto the image → the paired-column assertions go RED.
// • Remove the TAG_RE strip → the "{{token}} stripped" assertions go RED (tags leak into copy).
// • Remove the animation→purple stamp → the flavor assertion goes RED.
// • Drop the `!b.flavor` guard → "existing flavor not clobbered" goes RED.
// • Break repairSandwichedImages' absorption → the pair-integrity assertions go RED (pairs split).

console.log(`\npalau2 build-blocks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
