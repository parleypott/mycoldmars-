/**
 * Build system prompt for the AI copilot.
 * Uses 3-tier context model:
 *   Default: summary + highlighted passage + 10 segments before/after
 *   Deep context: full transcript (opt-in per message)
 */

/**
 * Build the default (lightweight) system prompt.
 * Includes the stored summary + a local window around the selection.
 */
export function buildCopilotSystemPrompt({ summary, segments, translations, speakerMap, selection, deepContext }) {
  let transcriptContext = '';

  if (deepContext) {
    // Full transcript
    transcriptContext = buildFullTranscriptContext(segments, translations, speakerMap);
  } else {
    // Local window: 10 segments before and after the selection
    transcriptContext = buildLocalWindow(segments, translations, speakerMap, selection);
  }

  return `You are an editorial assistant for a documentary filmmaker working with interview transcripts.

${summary ? `INTERVIEW SUMMARY:\n${summary}\n\n` : ''}${transcriptContext ? `TRANSCRIPT CONTEXT:\n${transcriptContext}\n\n` : ''}GUIDELINES:
- Always reference both the original language and the translation when discussing specific passages.
- Provide cultural context when relevant (Chinese idioms, historical references, regional expressions).
- When suggesting alternative translations, explain the nuance each captures differently.
- Be concise but thorough. The filmmaker needs practical, actionable insights.
- When asked about themes, connect specific quotes to broader narrative arcs.`;
}

/**
 * Build full transcript context (for deep context mode).
 */
function buildFullTranscriptContext(segments, translations, speakerMap) {
  const hasTranslations = translations && translations.length > 0;
  return segments.map((seg, i) => {
    const trans = hasTranslations ? translations[i] : null;
    const displayName = speakerMap?.[seg.speaker] || seg.speaker || 'Unknown';
    const original = seg.text || '';
    const translated = trans?.translated || original;
    if (hasTranslations && translated !== original) {
      return `[${seg.number}] ${displayName} (${seg.start}):\n  Original: ${original}\n  Translation: ${translated}`;
    }
    return `[${seg.number}] ${displayName} (${seg.start}): ${original}`;
  }).join('\n\n');
}

/**
 * Build local window context: 10 segments before and after the selection.
 */
function buildLocalWindow(segments, translations, speakerMap, selection) {
  if (!selection || !selection.segmentNumber) return '';

  const hasTranslations = translations && translations.length > 0;
  const segIdx = segments.findIndex(s => s.number === selection.segmentNumber);
  if (segIdx === -1) return '';

  const start = Math.max(0, segIdx - 10);
  const end = Math.min(segments.length, segIdx + 11);
  const windowSegs = segments.slice(start, end);

  return windowSegs.map((seg, i) => {
    const actualIdx = start + i;
    const trans = hasTranslations ? translations[actualIdx] : null;
    const displayName = speakerMap?.[seg.speaker] || seg.speaker || 'Unknown';
    const original = seg.text || '';
    const translated = trans?.translated || original;
    const marker = seg.number === selection.segmentNumber ? ' <<<SELECTED>>>' : '';
    if (hasTranslations && translated !== original) {
      return `[${seg.number}] ${displayName} (${seg.start}):${marker}\n  Original: ${original}\n  Translation: ${translated}`;
    }
    return `[${seg.number}] ${displayName} (${seg.start}):${marker} ${original}`;
  }).join('\n\n');
}

/**
 * Build the user message for a passage-specific question.
 */
export function buildPassagePrompt(selection, question) {
  let prompt = '';

  if (selection.text) {
    prompt += `HIGHLIGHTED PASSAGE:\n`;
    prompt += `  Translation: ${selection.text}\n`;
    if (selection.originalText) {
      prompt += `  Original: ${selection.originalText}\n`;
    }
    if (selection.speaker) {
      prompt += `  Speaker: ${selection.speaker}\n`;
    }
    if (selection.timecode) {
      prompt += `  Timecode: ${selection.timecode}\n`;
    }
    if (selection.tags && selection.tags.length > 0) {
      prompt += `  Tags: ${selection.tags.join(', ')}\n`;
    }
    prompt += '\n';
  }

  prompt += question;
  return prompt;
}

/**
 * Build prompt for multi-highlight questions (from Search view multi-select).
 */
export function buildMultiHighlightPrompt(highlights, question) {
  let prompt = 'SELECTED PASSAGES:\n\n';
  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];
    prompt += `[${i + 1}] From "${h.transcriptName || 'Unknown'}":\n`;
    prompt += `  Text: ${h.textPreview}\n`;
    if (h.originalTextPreview) prompt += `  Original: ${h.originalTextPreview}\n`;
    if (h.tagName) prompt += `  Tag: ${h.tagName}\n`;
    prompt += '\n';
  }
  prompt += question;
  return prompt;
}

/**
 * Build the prompt for generating a holistic summary from highlights.
 */
export function buildSummaryPrompt(highlights, editorialFocus) {
  let prompt = 'Generate a comprehensive editorial summary of this interview based on the highlighted passages.\n\n';

  if (editorialFocus) {
    prompt += `EDITORIAL FOCUS: ${editorialFocus}\n\n`;
  }

  // Group highlights by tag
  const byTag = {};
  for (const h of highlights) {
    const tagName = h.tagName || 'Untagged';
    if (!byTag[tagName]) byTag[tagName] = [];
    byTag[tagName].push(h);
  }

  for (const [tagName, items] of Object.entries(byTag)) {
    prompt += `## ${tagName}\n`;
    for (const item of items) {
      prompt += `- "${item.textPreview}"`;
      if (item.originalTextPreview) prompt += ` (原文: "${item.originalTextPreview}")`;
      prompt += '\n';
    }
    prompt += '\n';
  }

  prompt += `Provide:
1. **Thematic Analysis**: Key themes across all highlights, with specific quotes.
2. **Key Soundbites**: The strongest quotes for each category, ranked by editorial impact.
3. **Narrative Arc**: A suggested story structure based on these highlights.
4. **Cultural Notes**: Any cultural context the filmmaker should be aware of.
5. **Translation Notes**: Any passages where the translation may lose nuance.`;

  return prompt;
}

/**
 * Build the prompt for auto-generating the chronological interview summary.
 * This is called on first editor entry.
 */
export function buildAutoSummaryPrompt(segments, translations, speakerMap) {
  const hasTranslations = translations && translations.length > 0;

  const transcriptText = segments.map((seg, i) => {
    const trans = hasTranslations ? translations[i] : null;
    const displayName = speakerMap?.[seg.speaker] || seg.speaker || 'Unknown';
    const text = hasTranslations ? (trans?.translated || seg.text) : seg.text;
    return `[${seg.number}] ${displayName}: ${text}`;
  }).join('\n');

  return `Read this interview transcript and produce a chronological narrative summary.

FORMAT:
- Write it as a sequence of bullet points covering what the conversation discusses, in order.
- Be granular — capture each distinct topic shift or important point.
- Include the approximate segment numbers for each point so the reader can jump to that section.
- Focus on content, not meta-commentary. Say what was said, not "they discussed X."
- Keep each bullet to 1-2 sentences.
- Aim for 15-30 bullet points depending on interview length.

TRANSCRIPT:
${transcriptText}`;
}

/**
 * Quick action prompts.
 */
export const QUICK_ACTIONS = [
  { label: 'Cultural context', prompt: 'What cultural context should a Western audience know to understand this passage? Reference both the original language and the translation.' },
  { label: 'Alternative translation', prompt: 'Suggest 2-3 alternative translations of this passage, explaining the nuance each captures differently.' },
  { label: 'Is this idiomatic?', prompt: 'Is the speaker using any idioms, proverbs, or culturally specific expressions? If so, explain their meaning and whether the translation captures them.' },
];
