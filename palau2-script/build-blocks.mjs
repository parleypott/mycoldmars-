// Palau V2 — blocks assembler.
// Converts the parsed raw blocks (palau2-blocks-raw.json, produced from Johnny's V2 PDF pass)
// into the engine block format (palau2-blocks.json), mirroring palau-script/palau-blocks.json
// field conventions exactly. Deterministic + idempotent — rerun any time the raw parse changes:
//
//   bun palau2-script/build-blocks.mjs
//
// Three conversions (everything else passes through verbatim — ids stay stable):
//
//   1. DIRECTION TAGS. Right-column ("shown") direction blocks carry a synthetic leading
//      {{token}} the parser added ({{3d}} {{animation}} {{broll}} {{oncam}} {{direction}};
//      mapping Johnny-approved: 2d→animation, b-roll spellings + Drone→broll, ON CAM/ONCAM→oncam,
//      Composite/Montage/Map→direction). The engine encodes a right-column direction the way
//      palau-blocks.json does: a typed block (broll/oncam/montage) in lane:"shown" whose TEXT is
//      Johnny's verbatim wording — the tag word ("3d", "ON CAM", "B roll"…) is already his copy.
//      So we STRIP the synthetic token (restoring the verbatim text) and, per the approved
//      mapping, stamp flavor:"purple" (the ANIMATION legend color) on {{animation}} blocks that
//      don't already carry a flavor. The wp-dhl direction chips themselves are an EDIT-TIME
//      affordance (slash/convert menu applies the inline directionMark) — the seed can't carry
//      marks, exactly like V1.
//
//   2. IMAGES. Parsed image notes ({ type:"note", text:"[[IMAGE: f.png]] caption", imageRef,
//      imageKind }) become REAL image blocks: { type:"image", imageSrc:"/palau2/img/<f>",
//      imageAlt:<caption>, imageKind } — attrs-complete atoms for the engine's imageBlock node.
//      lane/width/pairId ride along so a paired shown-lane image keeps its column.
//
//   3. TITLE. "Palau V2 — The Human Element".
//
// Two-column pairs (lane/width/pairId), SOT timecodes (days 1-7, ambiguous interview-clip IDs
// left day:null — never invented), speakers, genres and flavors pass through UNTOUCHED.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const TAG_RE = /^\s*\{\{(3d|animation|broll|oncam|direction)\}\}\s*/;
const IMAGE_TEXT_RE = /^\s*\[\[IMAGE:\s*([^\]]+?)\s*\]\]\s*/;

export function convertBlock(raw) {
  const b = { ...raw };

  // 2 — IMAGE notes → real image blocks (attrs-complete; the engine's imageBlock atom).
  if (b.imageRef) {
    const caption = String(b.text || '').replace(IMAGE_TEXT_RE, '').trim();
    const out = {
      id: b.id,
      type: 'image',
      imageSrc: '/palau2/img/' + b.imageRef,
      imageAlt: caption,
      imageKind: b.imageKind === 'inspo' ? 'inspo' : 'shot',
    };
    if (b.flavor) out.flavor = b.flavor;
    if (b.lane) out.lane = b.lane;
    if (b.width) out.width = b.width;
    if (b.pairId) out.pairId = b.pairId;
    return out;
  }

  // 1 — DIRECTION tag tokens → strip (text returns to Johnny's verbatim copy);
  //     {{animation}} additionally gets the purple ANIMATION flavor (unless already flavored).
  const m = TAG_RE.exec(b.text || '');
  if (m) {
    b.text = String(b.text).replace(TAG_RE, '');
    if (m[1] === 'animation' && !b.flavor) b.flavor = 'purple';
  }
  return b;
}

// PAIR-INTEGRITY REPAIR. The engine pairs only CONTIGUOUS runs of the same pairId
// (document-builder groups a run, then splits said|shown). The raw parse placed two full-width
// image blocks BETWEEN the members of one pair (pair_27: the Premiere-timeline + transcript
// screenshots sit between the "(I EDITED THE A ROLL)" said on-cam and its shown b-roll) — which
// would silently break that pair into two full-width rows. Any un-paired image sandwiched inside
// a pair ADOPTS that pairId + the PRECEDING member's lane (the screenshots accompany the said
// on-cam they follow), so the pair stays intact and the images render in its column.
export function repairSandwichedImages(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'image' || b.pairId) continue;
    const prev = blocks[i - 1];
    if (!prev?.pairId) continue;
    // Is a LATER block a member of prev's pair (with only pair-less images between)?
    let j = i;
    while (j < blocks.length && blocks[j].type === 'image' && !blocks[j].pairId) j++;
    if (blocks[j]?.pairId === prev.pairId) {
      for (let k = i; k < j; k++) {
        blocks[k].pairId = prev.pairId;
        blocks[k].lane = prev.lane || 'said';
        blocks[k].width = 'half';
      }
    }
  }
  return blocks;
}

export function convert(rawDoc) {
  return {
    title: 'Palau V2 — The Human Element',
    blocks: repairSandwichedImages((rawDoc.blocks || []).map(convertBlock)),
  };
}

// CLI: read the checked-in raw parse, write the engine blocks file.
if (process.argv[1] && fileURLToPath(new URL(import.meta.url)) === process.argv[1]) {
  const raw = JSON.parse(readFileSync(here('./palau2-blocks-raw.json'), 'utf8'));
  const out = convert(raw);
  writeFileSync(here('./palau2-blocks.json'), JSON.stringify(out, null, 1) + '\n');
  const images = out.blocks.filter((b) => b.type === 'image').length;
  const pairs = new Set(out.blocks.map((b) => b.pairId).filter(Boolean)).size;
  const tagged = raw.blocks.filter((b) => TAG_RE.test(b.text || '')).length;
  console.log(`palau2-blocks.json: ${out.blocks.length} blocks · ${images} images · ${pairs} pairs · ${tagged} direction tags converted`);
}
