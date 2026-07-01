import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INPUT_PATH = '/tmp/palau-build/palau-structured.json';
const BLOCKS_URL = new URL('./palau-blocks.json', import.meta.url);
const SOURCE_URL = new URL('./palau-source.txt', import.meta.url);

const OUTPUT_TITLE = 'Palau — The Human Element';

const GENRE_MAP = {
  COLD_OPEN: 'cold_open',
  MAP: 'map',
  EXPLAINER: 'explainer',
  GROUND: 'ground',
  MONTAGE: 'montage',
  ENDING: 'ending',
};

const RIGHT_FLAVOR_MAP = {
  liked: 'gold',
  animation: 'purple',
  straggler: 'pink',
};

function readRows() {
  const raw = readFileSync(INPUT_PATH, 'utf8');
  const rows = JSON.parse(raw);

  if (!Array.isArray(rows)) {
    throw new Error('Expected input JSON to be an array.');
  }

  return rows;
}

export function hash6(value) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).slice(0, 6).padStart(6, '0');
}

export function applyTrims(text, trims) {
  let output = text ?? '';

  for (const trim of trims ?? []) {
    if (!trim) {
      continue;
    }

    const wrapped = `~~${trim}~~`;
    if (output.includes(wrapped)) {
      continue;
    }

    const at = output.indexOf(trim);
    if (at === -1) {
      continue;
    }

    output = `${output.slice(0, at)}${wrapped}${output.slice(at + trim.length)}`;
  }

  return output;
}

export function buildTimecode(cellText, timecodes) {
  const first = timecodes?.[0];
  const firstIn = timecodes?.find((entry) => entry?.kind === 'in') ?? first;
  const firstOut = timecodes?.find((entry) => entry?.kind === 'out');
  const day = firstIn?.day ?? null;

  const timecode = {
    day,
    tc: firstIn?.tc || '',
    ambiguous: day == null,
    raw: (cellText ?? '').slice(0, 200),
  };

  if (firstOut?.tc) {
    timecode.tcOut = firstOut.tc;
  }

  return timecode;
}

export function leftBlockFromCell(cell, pairId) {
  const text = applyTrims(cell?.text ?? '', cell?.trims);
  const typeMap = {
    vo: 'vo',
    sot: 'sot',
    oncam: 'oncam',
    text: 'vo',
  };

  const block = {
    type: typeMap[cell?.role] ?? 'vo',
    text,
    rawSource: text,
  };

  if (pairId) {
    block.lane = 'said';
    block.pairId = pairId;
    block.width = 'half';
  }

  if (cell?.keyLine) {
    block.flavor = 'yellow';
  }

  if (block.type === 'sot') {
    block.speaker = cell?.speaker ?? '';
    block.done = false;
    block.timecode = buildTimecode(text, cell?.timecodes ?? []);
  }

  return block;
}

export function rightBlockFromCell(cell, pairId) {
  const text = applyTrims(cell?.text ?? '', cell?.trims);
  const block = {
    type: 'broll',
    text,
    rawSource: text,
  };

  if (pairId) {
    block.lane = 'shown';
    block.pairId = pairId;
    block.width = 'half';
  }

  if (cell?.keyLine) {
    block.flavor = 'yellow';
  } else {
    const flavor = RIGHT_FLAVOR_MAP[cell?.flavor];
    if (flavor) {
      block.flavor = flavor;
    }
  }

  if (cell?.timecodes?.length) {
    block.timecode = buildTimecode(text, cell.timecodes);
  }

  return block;
}

function main() {
  const rows = readRows();
  const blocks = [];
  let blockIndex = 0;
  let pairCount = 0;

  function emit(block) {
    blockIndex += 1;
    const identityText = [
      block.type,
      block.title ?? '',
      block.genre ?? '',
      block.speaker ?? '',
      block.lane ?? '',
      block.text ?? '',
      block.rawSource ?? '',
    ].join('\n');

    blocks.push({
      id: `${block.type}_palau_${blockIndex}_${hash6(identityText)}`,
      ...block,
    });
  }

  rows.forEach((row, rowIndex) => {
    if (row.kind === 'chapter') {
      emit({
        type: 'chapter',
        genre: GENRE_MAP[row.genre],
        title: row.title,
        text: row.note || '',
        rawSource: row.title + (row.note ? `\n${row.note}` : ''),
      });
      return;
    }

    if (row.kind === 'scene') {
      emit({
        type: 'scene',
        title: row.title,
        text: row.note || '',
        rawSource: row.title + (row.note ? `\n${row.note}` : ''),
      });
      return;
    }

    if (row.kind === 'holdingbin') {
      const text = row.title + (row.text ? `\n${row.text}` : '');
      emit({
        type: 'bin',
        text,
        rawSource: text,
      });
      return;
    }

    if (row.kind === 'fullwidth') {
      emit({
        type: 'bin',
        text: row.text,
        rawSource: row.text,
      });
      return;
    }

    if (row.kind !== 'av') {
      throw new Error(`Unsupported row kind: ${row.kind}`);
    }

    if (row.left && row.right) {
      const pairId = `pair_palau_${rowIndex + 1}`;
      pairCount += 1;
      emit(leftBlockFromCell(row.left, pairId));
      emit(rightBlockFromCell(row.right, pairId));
      return;
    }

    if (row.left) {
      emit(leftBlockFromCell(row.left, ''));
      return;
    }

    if (row.right) {
      emit(rightBlockFromCell(row.right, ''));
      return;
    }
  });

  const payload = {
    title: OUTPUT_TITLE,
    blocks,
  };

  writeFileSync(BLOCKS_URL, JSON.stringify(payload, null, 2) + '\n');
  writeFileSync(
    SOURCE_URL,
    blocks.map((block) => block.rawSource).join('\n\n') + '\n',
  );

  const countsByType = {};
  for (const block of blocks) {
    countsByType[block.type] = (countsByType[block.type] || 0) + 1;
  }

  console.log(`total blocks: ${blocks.length}`);
  console.log(`counts by type: ${JSON.stringify(countsByType)}`);
  console.log(`pairs: ${pairCount}`);
}

// Only run the file->file build when invoked directly (node build-blocks.mjs).
// When imported by a test the pure transforms above are exercised without
// firing main() — which reads /tmp and would throw in a test context.
const invokedDirectly =
  Array.isArray(process.argv) &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main();
}
