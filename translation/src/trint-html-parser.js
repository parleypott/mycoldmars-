/**
 * Parse Trint's "Interactive transcripts (.html)" export into our segment shape.
 *
 * Trint uses Hyperaudio Lite markup:
 *   <p time="350" data-tc="00:00:00">
 *     <span class="speaker">SPEAKER NAME </span>
 *     <span class="timecode">[] </span>
 *     <span class="word" data-m="350"  data-d="320">Okay, </span>
 *     <span class="word" data-m="1130" data-d="40">friends, </span>
 *     ...
 *   </p>
 *
 * - `data-m` is the start in milliseconds (offset from media start).
 * - `data-d` is the duration in milliseconds.
 * - `<span class="speaker">` contains the speaker label.
 *
 * Output mirrors json-parser.js: { segments, wordTimings }
 *   segments: [{ number, speaker, start, end, text, duration }]
 *     — start/end are decimal-second strings.
 *   wordTimings: { [segmentNumber]: { start, end } } — precise bounds in seconds.
 *
 * If the user uploads the .html file alone, we parse it. If they upload a
 * .zip, we ask them to unzip first (CEP and File API can't open zips).
 */

const TARGET_WORDS = 5;
const EN_BREAK = /[.?!,;:]/;

export function parseTrintHTML(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const paragraphs = doc.querySelectorAll('p[time][data-tc]');
  if (paragraphs.length === 0) {
    throw new Error("No Trint utterances found. Make sure this is the .html file from Trint's Interactive transcripts export.");
  }

  const segments = [];
  const wordTimings = {};
  let seqNum = 1;
  let lastSpeaker = '';

  for (const p of paragraphs) {
    // Speaker — first .speaker span if present, else carry forward
    const spkEl = p.querySelector('.speaker');
    const speaker = spkEl ? cleanText(spkEl.textContent) : lastSpeaker;
    if (speaker) lastSpeaker = speaker;

    // Words
    const wordEls = p.querySelectorAll('.word');
    if (wordEls.length === 0) continue;

    const words = Array.from(wordEls).map(el => ({
      text: cleanText(el.textContent),
      startSec: msToSec(el.getAttribute('data-m')),
      durSec:   msToSec(el.getAttribute('data-d')),
    })).filter(w => w.text);

    if (words.length === 0) continue;

    // Short utterance — keep as a single segment.
    if (words.length <= TARGET_WORDS) {
      const num = seqNum++;
      const start = words[0].startSec;
      const last = words[words.length - 1];
      const end = last.startSec + last.durSec;
      segments.push({
        number: num,
        speaker,
        start: String(start),
        end: String(end),
        text: words.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim(),
        duration: '',
      });
      wordTimings[num] = { start, end };
      continue;
    }

    // Longer utterance — split into ~5-word sub-segments at punctuation when possible.
    const subGroups = splitIntoSubGroups(words);
    for (const group of subGroups) {
      const num = seqNum++;
      const start = group[0].startSec;
      const last = group[group.length - 1];
      const end = last.startSec + last.durSec;
      segments.push({
        number: num,
        speaker,
        start: String(start),
        end: String(end),
        text: group.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim(),
        duration: '',
      });
      wordTimings[num] = { start, end };
    }
  }

  return { segments, wordTimings };
}

function splitIntoSubGroups(words) {
  const groups = [];
  let current = [];

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const atTarget = current.length >= TARGET_WORDS;
    const isLast = i === words.length - 1;
    const wordText = words[i].text || '';
    const hasPunct = EN_BREAK.test(wordText.charAt(wordText.length - 1));

    if (isLast || (atTarget && hasPunct) || current.length >= TARGET_WORDS + 3) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    if (groups.length > 0 && current.length <= 2) {
      groups[groups.length - 1].push(...current);
    } else {
      groups.push(current);
    }
  }
  return groups;
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function msToSec(msAttr) {
  const ms = parseFloat(msAttr);
  return isFinite(ms) ? ms / 1000 : 0;
}
