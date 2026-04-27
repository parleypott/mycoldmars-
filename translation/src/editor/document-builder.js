/**
 * Build a Tiptap-compatible JSON document from segments + translations.
 * Groups consecutive segments by speaker into speaker blocks.
 * If translations is null/empty (English-only), uses segment text directly.
 */
/**
 * Map language names from Claude analysis to ISO 639-1 codes.
 */
function toLangCode(lang) {
  if (!lang) return '';
  const l = lang.toLowerCase();
  if (l.includes('chinese') || l.includes('mandarin') || l.includes('cantonese')) return 'ZH';
  if (l.includes('english')) return 'EN';
  if (l.includes('japanese')) return 'JA';
  if (l.includes('korean')) return 'KO';
  if (l.includes('french')) return 'FR';
  if (l.includes('spanish')) return 'ES';
  if (l.includes('german')) return 'DE';
  if (l.includes('portuguese')) return 'PT';
  if (l.includes('italian')) return 'IT';
  if (l.includes('russian')) return 'RU';
  if (l.includes('arabic')) return 'AR';
  if (l.includes('thai')) return 'TH';
  if (l.includes('vietnamese')) return 'VI';
  if (l.includes('indonesian') || l.includes('malay')) return 'ID';
  if (l.includes('hindi')) return 'HI';
  if (l.includes('mix')) return 'MIX';
  // Return first 2 chars uppercased as fallback
  const first = lang.trim().split(/\s/)[0];
  return first.length <= 3 ? first.toUpperCase() : first.slice(0, 2).toUpperCase();
}

export function buildEditorDocument(segments, translations, speakerColors, speakerMap, hiddenSpeakers, languageMap) {
  const hasTranslations = translations && translations.length > 0;
  const groups = [];
  let currentGroup = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;

    const trans = hasTranslations ? translations[i] : null;
    const speaker = seg.speaker || 'Unknown';

    if (!currentGroup || currentGroup.speaker !== speaker) {
      currentGroup = { speaker, segments: [] };
      groups.push(currentGroup);
    }

    currentGroup.segments.push({
      number: seg.number,
      start: seg.start,
      end: seg.end,
      // For English-only: original and display text are the same
      originalText: hasTranslations ? seg.text : '',
      translated: hasTranslations
        ? (trans?.translated || trans?.original || seg.text)
        : seg.text,
      unintelligible: trans?.unintelligible || false,
    });
  }

  // Convert groups to Tiptap JSON nodes
  const content = groups.map(group => {
    const color = speakerColors[group.speaker] || '#DD2C1E';
    const isHidden = (hiddenSpeakers || []).includes(group.speaker);

    // Build paragraph content — each segment is text with a segment mark
    const paraContent = group.segments.map(seg => {
      const text = seg.unintelligible ? '[unintelligible] ' : seg.translated + ' ';
      return {
        type: 'text',
        text,
        marks: [{
          type: 'segment',
          attrs: {
            number: seg.number,
            start: seg.start,
            end: seg.end,
            originalText: seg.originalText,
          },
        }],
      };
    });

    // Look up language for this raw speaker name
    const langRaw = languageMap?.[group.speaker] || '';
    const langCode = toLangCode(langRaw);

    return {
      type: 'speakerBlock',
      attrs: {
        speaker: speakerMap?.[group.speaker] || group.speaker,
        color,
        visible: !isHidden,
        dismissed: isHidden,
        language: langCode,
      },
      content: [{
        type: 'paragraph',
        content: paraContent,
      }],
    };
  });

  return { type: 'doc', content };
}

/**
 * Walk editor JSON tree and collect segment numbers from dismissed speaker blocks.
 * Returns a Set<number> of segment numbers that belong to dismissed blocks.
 */
export function getDismissedSegmentNumbers(editorState) {
  const dismissed = new Set();
  if (!editorState?.content) return dismissed;

  for (const block of editorState.content) {
    if (block.type === 'speakerBlock' && block.attrs?.dismissed) {
      // Walk paragraphs inside the block to find segment marks
      if (block.content) {
        for (const para of block.content) {
          if (para.content) {
            for (const node of para.content) {
              if (node.marks) {
                for (const mark of node.marks) {
                  if (mark.type === 'segment' && mark.attrs?.number != null) {
                    dismissed.add(mark.attrs.number);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return dismissed;
}

/**
 * Extract highlights from editor state for saving to the highlights table.
 */
export function extractHighlightsFromEditor(editorState) {
  const highlights = [];
  if (!editorState?.content) return highlights;

  function walk(node) {
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'highlight' && mark.attrs?.tagId) {
          highlights.push({
            tagId: mark.attrs.tagId,
            segmentNumbers: mark.attrs.segmentNumbers || [],
            textPreview: node.text?.slice(0, 200) || '',
            originalTextPreview: mark.attrs.originalText?.slice(0, 200) || '',
            note: mark.attrs.note || '',
          });
        }
      }
    }
    if (node.content) {
      for (const child of node.content) walk(child);
    }
  }

  walk(editorState);
  return highlights;
}
