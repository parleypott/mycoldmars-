/**
 * Build system prompt for the AI copilot based on transcript context.
 */
export function buildCopilotSystemPrompt(segments, translations, speakerMap) {
  // Build full transcript context
  const transcriptLines = segments.map((seg, i) => {
    const trans = translations[i];
    const displayName = speakerMap?.[seg.speaker] || seg.speaker || 'Unknown';
    const original = seg.text || '';
    const translated = trans?.translated || original;
    return `[${seg.number}] ${displayName} (${seg.start}):\n  Original: ${original}\n  Translation: ${translated}`;
  }).join('\n\n');

  return `You are an editorial assistant for a documentary filmmaker working with interview transcripts.

You help interpret, contextualize, and analyze interview content. The filmmaker works primarily with Chinese-language interviews translated to English.

FULL TRANSCRIPT:
${transcriptLines}

GUIDELINES:
- Always reference both the original language and the translation when discussing specific passages.
- Provide cultural context when relevant (Chinese idioms, historical references, regional expressions).
- When suggesting alternative translations, explain the nuance being captured or lost.
- Be concise but thorough. The filmmaker needs practical, actionable insights.
- When asked about themes, connect specific quotes to broader narrative arcs.`;
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
 * Build the prompt for generating a holistic summary from highlights.
 */
export function buildSummaryPrompt(highlights, tags, editorialFocus) {
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
 * Quick action prompts.
 */
export const QUICK_ACTIONS = [
  { label: 'Cultural context', prompt: 'What cultural context should a Western audience know to understand this passage? Reference both the original language and the translation.' },
  { label: 'Alternative translation', prompt: 'Suggest 2-3 alternative translations of this passage, explaining the nuance each captures differently.' },
  { label: 'Is this idiomatic?', prompt: 'Is the speaker using any idioms, proverbs, or culturally specific expressions? If so, explain their meaning and whether the translation captures them.' },
];
