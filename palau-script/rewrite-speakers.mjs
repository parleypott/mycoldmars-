import { readFileSync, writeFileSync } from 'node:fs';
import { extractFullSotSpeaker } from './build-blocks.mjs';

const BLOCKS_URL = new URL('./palau-blocks.json', import.meta.url);

const payload = JSON.parse(readFileSync(BLOCKS_URL, 'utf8'));
let updated = 0;

for (const block of payload.blocks || []) {
  if (block?.type !== 'sot' || !block?.timecode?.tc) {
    continue;
  }

  const nextSpeaker = extractFullSotSpeaker(block.text, block.speaker);
  if (!nextSpeaker || nextSpeaker === block.speaker) {
    continue;
  }

  block.speaker = nextSpeaker;
  updated += 1;
}

writeFileSync(BLOCKS_URL, JSON.stringify(payload, null, 2) + '\n');
console.log(`updated speakers: ${updated}`);
