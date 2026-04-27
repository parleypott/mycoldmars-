/**
 * Parse Happy Scribe word-level JSON export into segments
 * matching the same contract as parseCSV().
 *
 * Input: JSON array of utterances, each with:
 *   - speaker: string
 *   - words: [{ text, data_start, data_end, ... }]
 *   - original_translation_text: string (Chinese original)
 *
 * Output: { segments, wordTimings }
 *   segments: [{ number, speaker, start, end, text, duration }]
 *   wordTimings: Map<number, { start, end }> (segment number → precise bounds)
 */

// Chinese punctuation used to split original text into clauses
const ZH_PUNCT = /([。，！？；、：\n])/;

// English punctuation that makes a good sub-segment boundary
const EN_BREAK = /[.?!,;:]/;

const TARGET_WORDS = 5;

export function parseJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error('Expected a JSON array of utterances');
  }

  const segments = [];
  const wordTimings = {};
  let seqNum = 1;

  for (const utterance of data) {
    const speaker = utterance.speaker || '';
    const words = utterance.words || [];
    const chineseText = (utterance.original_translation_text || '').trim();

    // Edge case: no words at all
    if (words.length === 0) {
      const start = String(utterance.data_start ?? '0');
      const end = String(utterance.data_end ?? '0');
      const text = chineseText || '';
      if (text) {
        const num = seqNum++;
        segments.push({ number: num, speaker, start, end, text, duration: '' });
        wordTimings[num] = { start: parseFloat(start) || 0, end: parseFloat(end) || 0 };
      }
      continue;
    }

    // Short utterance — keep as single segment
    if (words.length <= TARGET_WORDS) {
      const start = String(words[0].data_start ?? '0');
      const end = String(words[words.length - 1].data_end ?? '0');
      const text = chineseText || words.map(w => w.text || '').join(' ');
      const num = seqNum++;
      segments.push({ number: num, speaker, start, end, text, duration: '' });
      wordTimings[num] = { start: parseFloat(start) || 0, end: parseFloat(end) || 0 };
      continue;
    }

    // Split words into sub-groups of ~TARGET_WORDS, preferring punctuation breaks
    const subGroups = splitIntoSubGroups(words);

    // Split Chinese text to align with sub-groups
    const chineseChunks = chineseText
      ? alignChineseChunks(chineseText, subGroups)
      : null;

    for (let g = 0; g < subGroups.length; g++) {
      const group = subGroups[g];
      const start = String(group[0].data_start ?? '0');
      const end = String(group[group.length - 1].data_end ?? '0');
      const text = chineseChunks
        ? chineseChunks[g]
        : group.map(w => w.text || '').join(' ');
      const num = seqNum++;
      segments.push({ number: num, speaker, start, end, text, duration: '' });
      wordTimings[num] = { start: parseFloat(start) || 0, end: parseFloat(end) || 0 };
    }
  }

  if (segments.length === 0) {
    throw new Error('No segments found in JSON');
  }

  return { segments, wordTimings };
}

/**
 * Split an array of word objects into sub-groups of ~TARGET_WORDS,
 * preferring to break after punctuation.
 */
function splitIntoSubGroups(words) {
  const groups = [];
  let current = [];

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);

    const atTarget = current.length >= TARGET_WORDS;
    const isLast = i === words.length - 1;
    const wordText = words[i].text || '';
    const hasPunct = EN_BREAK.test(wordText.charAt(wordText.length - 1));

    // Break if we've hit target and are at punctuation, or if well past target
    if (isLast || (atTarget && hasPunct) || current.length >= TARGET_WORDS + 3) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    // Merge tiny remainder into previous group
    if (groups.length > 0 && current.length <= 2) {
      groups[groups.length - 1].push(...current);
    } else {
      groups.push(current);
    }
  }

  return groups;
}

/**
 * Split Chinese text into chunks aligned proportionally to English sub-groups.
 * Splits at Chinese punctuation first, then merges/distributes to match group count.
 */
function alignChineseChunks(text, subGroups) {
  const numGroups = subGroups.length;

  // Split Chinese text at punctuation boundaries, keeping delimiters
  const parts = text.split(ZH_PUNCT).filter(p => p.length > 0);

  // Reassemble: attach punctuation to the preceding text
  const clauses = [];
  for (let i = 0; i < parts.length; i++) {
    if (ZH_PUNCT.test(parts[i]) && clauses.length > 0) {
      clauses[clauses.length - 1] += parts[i];
    } else {
      clauses.push(parts[i]);
    }
  }

  // Filter empty clauses
  const nonEmpty = clauses.filter(c => c.trim().length > 0);

  if (nonEmpty.length === 0) {
    // Fall back to splitting English words
    return subGroups.map(g => g.map(w => w.text || '').join(' '));
  }

  if (nonEmpty.length === numGroups) {
    return nonEmpty;
  }

  if (nonEmpty.length > numGroups) {
    // More clauses than groups — merge clauses proportionally
    return mergeToCount(nonEmpty, numGroups);
  }

  // Fewer clauses than groups — distribute by character count
  return distributeToCount(nonEmpty, numGroups);
}

/**
 * Merge an array of strings down to `target` entries by combining adjacent items.
 */
function mergeToCount(items, target) {
  const result = [...items];
  while (result.length > target) {
    // Find shortest adjacent pair and merge
    let minLen = Infinity;
    let minIdx = 0;
    for (let i = 0; i < result.length - 1; i++) {
      const len = result[i].length + result[i + 1].length;
      if (len < minLen) {
        minLen = len;
        minIdx = i;
      }
    }
    result[minIdx] = result[minIdx] + result[minIdx + 1];
    result.splice(minIdx + 1, 1);
  }
  return result;
}

/**
 * Distribute items across `target` slots. If fewer items than target,
 * the last item gets spread across remaining slots.
 */
function distributeToCount(items, target) {
  if (items.length >= target) return items.slice(0, target);

  // Calculate proportional word counts per group
  const totalChars = items.reduce((s, c) => s + c.length, 0);
  const result = [];
  let itemIdx = 0;
  let charBudget = 0;

  const charsPerGroup = totalChars / target;

  for (let g = 0; g < target; g++) {
    if (itemIdx >= items.length) {
      // Out of Chinese text — use empty string (will show English fallback)
      result.push('');
      continue;
    }

    let chunk = '';
    charBudget += charsPerGroup;

    while (itemIdx < items.length && charBudget >= items[itemIdx].length / 2) {
      charBudget -= items[itemIdx].length;
      chunk += items[itemIdx];
      itemIdx++;
    }

    if (!chunk && itemIdx < items.length) {
      chunk = items[itemIdx];
      itemIdx++;
    }

    result.push(chunk);
  }

  // Dump remaining
  if (itemIdx < items.length && result.length > 0) {
    result[result.length - 1] += items.slice(itemIdx).join('');
  }

  return result;
}
