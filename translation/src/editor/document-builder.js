/**
 * Build a Tiptap-compatible JSON document from segments + translations.
 * Groups consecutive segments by speaker into speaker blocks.
 * If translations is null/empty (English-only), uses segment text directly.
 */
export function buildEditorDocument(segments, translations, speakerColors, speakerMap, hiddenSpeakers) {
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

    return {
      type: 'speakerBlock',
      attrs: {
        speaker: speakerMap?.[group.speaker] || group.speaker,
        color,
        visible: !isHidden,
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
