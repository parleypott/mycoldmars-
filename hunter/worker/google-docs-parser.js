/**
 * Rich Google Docs parser for Hunter Script Copilot.
 * Transforms Docs API JSON into a structured intermediate format
 * preserving ALL formatting — colors, bold, italic, highlights, table structure.
 *
 * Does NOT interpret what colors mean — that comes from training.
 */

/**
 * Main entry point. Parses Docs API JSON into a structured intermediate format.
 *
 * @param {object} docJson - Full Google Docs API response (documents.get)
 * @param {object} [opts] - Options
 * @param {number} [opts.tabIndex] - If set, only parse this tab (0-based). Default: all tabs.
 * @returns {{ docId, title, revisionId, fetchedAt, elements[], colorProfile, stats }}
 */
export function parseDocStructured(docJson, opts = {}) {
  const elements = [];
  let tabs = docJson.tabs || [];

  // Tab filtering at parse time (in case fetchDocStructured wasn't filtered)
  if (opts.tabIndex != null && tabs.length > 0) {
    const idx = opts.tabIndex;
    if (idx >= 0 && idx < tabs.length) {
      tabs = [tabs[idx]];
    }
  }

  if (tabs.length > 0) {
    // Parse tab(s)
    for (const tab of tabs) {
      const tabTitle = tab.tabProperties?.title || 'Untitled Tab';
      const tabBody = tab.documentTab?.body?.content || [];

      if (tabBody.length === 0) continue;

      // Only add tab heading if multiple tabs
      if (tabs.length > 1) {
        elements.push({ type: 'heading', level: 1, text: `[TAB: ${tabTitle}]`, runs: [], isTab: true });
      }

      parseBodyContent(tabBody, elements);
    }
  } else {
    // Single-tab / legacy body
    const body = docJson.body?.content || [];
    parseBodyContent(body, elements);
  }

  const colorProfile = buildColorProfile(elements);
  const stats = computeStats(elements);
  stats.tabCount = tabs.length || 1;

  return {
    docId: docJson.documentId,
    title: docJson.title,
    revisionId: docJson.revisionId || null,
    fetchedAt: new Date().toISOString(),
    elements,
    colorProfile,
    stats,
  };
}

/**
 * Parse body content elements into our intermediate element array.
 */
function parseBodyContent(bodyContent, elements) {
  for (const element of bodyContent) {
    if (element.paragraph) {
      const parsed = parseParagraph(element.paragraph);
      if (parsed) elements.push(parsed);
    } else if (element.table) {
      const beats = extractTableBeats(element.table);
      elements.push(...beats);
    } else if (element.sectionBreak) {
      elements.push({ type: 'section_break' });
    }
  }
}

/**
 * Parse a paragraph element into our intermediate format.
 */
function parseParagraph(para) {
  const runs = [];
  let fullText = '';

  for (const el of para.elements || []) {
    if (el.textRun) {
      const text = el.textRun.content || '';
      if (text.trim() === '') {
        fullText += text;
        continue;
      }
      const style = extractRunStyle(el.textRun.textStyle || {});
      runs.push({ text, style });
      fullText += text;
    }
  }

  if (!fullText.trim()) return null;

  // Detect heading level from paragraph style
  const namedStyle = para.paragraphStyle?.namedStyleType || '';
  const headingMatch = namedStyle.match(/HEADING_(\d)/);

  if (headingMatch) {
    return {
      type: 'heading',
      level: parseInt(headingMatch[1]),
      text: fullText.trim(),
      runs,
    };
  }

  return {
    type: 'paragraph',
    text: fullText.trim(),
    runs,
  };
}

/**
 * Extract formatting style from a textStyle object.
 * Returns only non-default values to keep output compact.
 */
function extractRunStyle(textStyle) {
  const style = {};

  if (textStyle.bold) style.bold = true;
  if (textStyle.italic) style.italic = true;
  if (textStyle.underline) style.underline = true;
  if (textStyle.strikethrough) style.strikethrough = true;

  // Background color (highlight) — the key signal for script analysis
  const bg = textStyle.backgroundColor?.color?.rgbColor;
  if (bg) {
    style.highlight = rgbToHex(bg);
  }

  // Foreground color (text color)
  const fg = textStyle.foregroundColor?.color?.rgbColor;
  if (fg) {
    const hex = rgbToHex(fg);
    // Skip black/near-black — it's the default
    if (hex !== '#000000' && hex !== '#1a1a1a') {
      style.color = hex;
    }
  }

  // Font info (only if non-default)
  if (textStyle.fontSize?.magnitude) {
    style.fontSize = textStyle.fontSize.magnitude;
  }
  if (textStyle.weightedFontFamily?.fontFamily &&
      textStyle.weightedFontFamily.fontFamily !== 'Arial') {
    style.font = textStyle.weightedFontFamily.fontFamily;
  }

  return Object.keys(style).length > 0 ? style : {};
}

/**
 * Convert Google Docs RGB color object to hex string.
 * Docs API uses { red: 0-1, green: 0-1, blue: 0-1 }.
 */
function rgbToHex({ red = 0, green = 0, blue = 0 }) {
  const r = Math.round((red || 0) * 255);
  const g = Math.round((green || 0) * 255);
  const b = Math.round((blue || 0) * 255);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Extract table rows as voice/visual beat pairs.
 * Each table row with 2 cells becomes a "beat" with voice and visual columns.
 */
export function extractTableBeats(tableElement) {
  const rows = tableElement.tableRows || [];
  if (rows.length === 0) return [];

  // Detect column roles from the first few rows
  const numCols = rows[0]?.tableCells?.length || 0;
  if (numCols < 2) {
    // Single-column table — treat as regular paragraphs
    return rows.flatMap(row =>
      (row.tableCells || []).flatMap(cell => parseCellContent(cell))
    );
  }

  // For 2+ column tables, detect which is voice vs visual
  const columnRoles = detectColumnRoles(rows);

  const beats = [];
  for (const row of rows) {
    const cells = row.tableCells || [];
    if (cells.length < 2) continue;

    // For 3+ column tables, find the two most content-rich columns
    // (some scripts use an empty first column for numbering/spacing)
    let voiceIdx = columnRoles.voiceColumn;
    let visualIdx = columnRoles.visualColumn;

    const parsedCells = cells.map(c => parseCellContent(c));

    // Skip header rows
    if (isHeaderRow(parsedCells[voiceIdx] || [], parsedCells[visualIdx] || [])) continue;

    const voiceCol = parsedCells[voiceIdx] || [];
    const visualCol = parsedCells[visualIdx] || [];

    // Skip empty rows
    if (!hasContent(voiceCol) && !hasContent(visualCol)) continue;

    // Collect any extra columns as supplementary content
    const extras = [];
    for (let i = 0; i < parsedCells.length; i++) {
      if (i !== voiceIdx && i !== visualIdx && hasContent(parsedCells[i])) {
        extras.push(...parsedCells[i]);
      }
    }

    const beat = {
      type: 'beat',
      voice: {
        text: elementsToText(voiceCol),
        runs: elementsToRuns(voiceCol),
      },
      visual: {
        text: elementsToText(visualCol),
        runs: elementsToRuns(visualCol),
      },
    };

    // Attach extra column content if present
    if (extras.length > 0) {
      beat.extra = {
        text: elementsToText(extras),
        runs: elementsToRuns(extras),
      };
    }

    beats.push(beat);
  }

  return beats;
}

/**
 * Parse the content of a table cell into paragraph elements.
 */
function parseCellContent(cell) {
  const elements = [];
  for (const el of cell.content || []) {
    if (el.paragraph) {
      const parsed = parseParagraph(el.paragraph);
      if (parsed) elements.push(parsed);
    }
  }
  return elements;
}

/**
 * Auto-detect which column is voice vs visual.
 * Voice columns: narration, dialogue, voiceover text
 * Visual columns: shot descriptions, camera directions, "B-roll", "animation"
 *
 * Uses heuristics: visual columns tend to have more color highlights,
 * mentions of cameras/shots, shorter fragmentary sentences.
 */
export function detectColumnRoles(tableRows) {
  const numCols = tableRows[0]?.tableCells?.length || 2;
  const visualKeywords = /\b(shot|b-?roll|wide|close|aerial|animation|animated|archive|stock|footage|camera|pov|establishing|cutaway|montage|graphic|map|diagram|photo|image|video)\b/i;
  const voiceKeywords = /\b(narrator|voiceover|v\.?o\.?|dialogue|interview|sot|sound bite|we hear|i say|says)\b/i;

  // Score each column
  const colScores = Array.from({ length: numCols }, () => ({ visual: 0, voice: 0, charCount: 0 }));
  const sampleRows = tableRows.slice(0, Math.min(10, tableRows.length));

  for (const row of sampleRows) {
    const cells = row.tableCells || [];
    for (let i = 0; i < Math.min(cells.length, numCols); i++) {
      const text = cellToPlainText(cells[i]);
      colScores[i].charCount += text.length;

      if (visualKeywords.test(text)) colScores[i].visual += 2;
      if (voiceKeywords.test(text)) colScores[i].voice += 2;

      // Highlight colors suggest visual direction
      const hlCount = countHighlights(cells[i]);
      if (hlCount > 0) colScores[i].visual += hlCount;
    }
  }

  // Filter out empty/numbering columns (very low char count)
  const avgChars = colScores.reduce((s, c) => s + c.charCount, 0) / numCols;
  const contentCols = colScores
    .map((s, i) => ({ ...s, idx: i }))
    .filter(s => s.charCount > avgChars * 0.15); // must have >15% of average content

  // If we filtered down to fewer than 2, fall back to the two with most content
  if (contentCols.length < 2) {
    const sorted = colScores.map((s, i) => ({ ...s, idx: i })).sort((a, b) => b.charCount - a.charCount);
    contentCols.length = 0;
    contentCols.push(sorted[0], sorted[1]);
  }

  // Among content columns, pick voice and visual
  // Voice = highest voice score or longest prose; Visual = highest visual score or most highlights
  let bestVoice = contentCols[0];
  let bestVisual = contentCols[1] || contentCols[0];

  for (const col of contentCols) {
    if (col.voice > bestVoice.voice || (col.voice === bestVoice.voice && col.charCount > bestVoice.charCount)) {
      bestVoice = col;
    }
    if (col.visual > bestVisual.visual) {
      bestVisual = col;
    }
  }

  // If both picked the same column, use the two highest-content columns
  if (bestVoice.idx === bestVisual.idx) {
    const sorted = contentCols.sort((a, b) => b.charCount - a.charCount);
    bestVoice = sorted[0];
    bestVisual = sorted[1] || sorted[0];
    // Longer prose is usually voice
    if (bestVisual.charCount > bestVoice.charCount) {
      [bestVoice, bestVisual] = [bestVisual, bestVoice];
    }
  }

  const totalScore = contentCols.reduce((s, c) => s + c.visual + c.voice, 0) || 1;
  return {
    voiceColumn: bestVoice.idx,
    visualColumn: bestVisual.idx,
    totalColumns: numCols,
    contentColumns: contentCols.map(c => c.idx),
    confidence: Math.abs(bestVoice.voice + bestVisual.visual) / totalScore,
  };
}

/**
 * Build a color profile from all elements.
 * Clusters highlight colors, counts occurrences, samples representative text.
 */
export function buildColorProfile(elements) {
  const colors = {};

  function processRuns(runs) {
    for (const run of runs || []) {
      const highlight = run.style?.highlight;
      if (!highlight) continue;

      // Normalize similar colors (within ~10 RGB distance)
      const normalizedColor = normalizeColor(highlight, Object.keys(colors));

      if (!colors[normalizedColor]) {
        colors[normalizedColor] = { count: 0, sampleTexts: [], totalChars: 0 };
      }
      colors[normalizedColor].count++;
      colors[normalizedColor].totalChars += (run.text || '').length;
      if (colors[normalizedColor].sampleTexts.length < 5) {
        const sample = (run.text || '').trim().slice(0, 80);
        if (sample.length > 10) {
          colors[normalizedColor].sampleTexts.push(sample);
        }
      }
    }
  }

  for (const el of elements) {
    if (el.runs) processRuns(el.runs);
    if (el.voice?.runs) processRuns(el.voice.runs);
    if (el.visual?.runs) processRuns(el.visual.runs);
  }

  return colors;
}

/**
 * Normalize a color to the nearest existing color in the profile,
 * or return it as-is if no close match exists.
 */
function normalizeColor(hex, existingColors) {
  const [r, g, b] = hexToRgb(hex);

  for (const existing of existingColors) {
    const [er, eg, eb] = hexToRgb(existing);
    const distance = Math.sqrt(
      Math.pow(r - er, 2) + Math.pow(g - eg, 2) + Math.pow(b - eb, 2)
    );
    if (distance < 30) return existing; // close enough — merge
  }

  return hex;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/**
 * Compute document statistics.
 */
function computeStats(elements) {
  let totalBeats = 0;
  let totalParagraphs = 0;
  let wordCount = 0;
  let coloredRunCount = 0;

  for (const el of elements) {
    if (el.type === 'beat') {
      totalBeats++;
      wordCount += countWords(el.voice?.text || '') + countWords(el.visual?.text || '');
      coloredRunCount += countColoredRuns(el.voice?.runs);
      coloredRunCount += countColoredRuns(el.visual?.runs);
    } else if (el.type === 'paragraph' || el.type === 'heading') {
      totalParagraphs++;
      wordCount += countWords(el.text || '');
      coloredRunCount += countColoredRuns(el.runs);
    }
  }

  return { totalBeats, totalParagraphs, wordCount, coloredRunCount };
}

function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function countColoredRuns(runs) {
  return (runs || []).filter(r => r.style?.highlight || r.style?.color).length;
}

function cellToPlainText(cell) {
  return (cell.content || [])
    .map(el => (el.paragraph?.elements || [])
      .map(e => e.textRun?.content || '').join('')
    ).join(' ').trim();
}

function countHighlights(cell) {
  let count = 0;
  for (const el of cell.content || []) {
    for (const pe of el.paragraph?.elements || []) {
      if (pe.textRun?.textStyle?.backgroundColor?.color?.rgbColor) count++;
    }
  }
  return count;
}

function isHeaderRow(col0Elements, col1Elements) {
  const text0 = elementsToText(col0Elements).toLowerCase();
  const text1 = elementsToText(col1Elements).toLowerCase();
  const headerTerms = [
    'voice', 'visual', 'audio', 'video', 'narration', 'picture',
    'column a', 'column b', 'col a', 'col b',
    'words', 'direction', 'v.o.', 'vo ', 'oncam', 'on cam',
    'script', 'action', 'description', 'general direction',
    'archive needed', 'archive found', 'animation', 'b roll',
  ];
  // Header if both columns match header terms, OR if either column has 3+ header-like terms (legend row)
  const matches0 = headerTerms.filter(t => text0.includes(t)).length;
  const matches1 = headerTerms.filter(t => text1.includes(t)).length;
  return (matches0 >= 1 && matches1 >= 1) || matches0 >= 3 || matches1 >= 3;
}

function hasContent(elements) {
  return elements.some(el => (el.text || '').trim().length > 0);
}

function elementsToText(elements) {
  return elements.map(el => el.text || '').join('\n').trim();
}

function elementsToRuns(elements) {
  return elements.flatMap(el => el.runs || []);
}

/**
 * Chunk a parsed document by headings for analysis.
 * Each chunk includes all elements between headings, with formatting preserved.
 * Returns array of { title, elements[], text (annotated) }.
 */
export function chunkParsedDoc(parsedDoc, maxChars = 6000) {
  const chunks = [];
  let current = { title: 'Opening', elements: [] };

  for (const el of parsedDoc.elements) {
    if (el.type === 'heading' && current.elements.length > 0) {
      chunks.push(finalizeChunk(current));
      current = { title: el.text, elements: [el] };
    } else {
      current.elements.push(el);

      // Split on size if section gets too long
      const text = buildAnnotatedText(current.elements, {});
      if (text.length > maxChars) {
        chunks.push(finalizeChunk(current));
        current = { title: `${current.title} (cont.)`, elements: [] };
      }
    }
  }

  if (current.elements.length > 0) {
    chunks.push(finalizeChunk(current));
  }

  return chunks.filter(c => c.text.trim().length > 50);
}

function finalizeChunk(chunk) {
  return {
    title: chunk.title,
    elements: chunk.elements,
    text: buildAnnotatedText(chunk.elements, {}),
    beatCount: chunk.elements.filter(e => e.type === 'beat').length,
  };
}

/**
 * Build annotated text representation where formatting is explicit.
 * Used for LLM prompts — makes colors/formatting visible in plain text.
 *
 * @param {object[]} elements - Array of parsed elements
 * @param {object} colorConventions - Optional mapping of colors to meanings (from training)
 */
export function buildAnnotatedText(elements, colorConventions = {}) {
  const lines = [];

  for (const el of elements) {
    if (el.type === 'heading') {
      lines.push(`\n## ${el.text}\n`);
    } else if (el.type === 'beat') {
      lines.push('---BEAT---');
      if (el.voice?.text) {
        lines.push(`VOICE: ${annotateRuns(el.voice.runs, colorConventions) || el.voice.text}`);
      }
      if (el.visual?.text) {
        lines.push(`VISUAL: ${annotateRuns(el.visual.runs, colorConventions) || el.visual.text}`);
      }
    } else if (el.type === 'paragraph') {
      const annotated = annotateRuns(el.runs, colorConventions);
      lines.push(annotated || el.text);
    } else if (el.type === 'section_break') {
      lines.push('---');
    }
  }

  return lines.join('\n');
}

/**
 * Annotate runs with inline formatting markers.
 * E.g., "[PURPLE: wide aerial of highway]" or "[BOLD: ACT THREE]"
 */
function annotateRuns(runs, colorConventions = {}) {
  if (!runs?.length) return '';

  return runs.map(run => {
    const text = (run.text || '').trim();
    if (!text) return '';

    const annotations = [];
    const style = run.style || {};

    if (style.highlight) {
      const meaning = colorConventions[style.highlight];
      if (meaning) {
        annotations.push(meaning.toUpperCase());
      } else {
        // Use color name approximation
        annotations.push(approximateColorName(style.highlight));
      }
    }

    if (style.bold) annotations.push('BOLD');
    if (style.italic) annotations.push('ITALIC');
    if (style.strikethrough) annotations.push('STRUCK');

    if (annotations.length > 0) {
      return `[${annotations.join('/')}: ${text}]`;
    }
    return text;
  }).join(' ');
}

/**
 * Approximate a human-readable color name from a hex value.
 */
function approximateColorName(hex) {
  const [r, g, b] = hexToRgb(hex);

  // Common Google Docs highlight colors
  const knownColors = [
    { name: 'PURPLE', r: 153, g: 0, b: 255 },
    { name: 'RED', r: 255, g: 0, b: 0 },
    { name: 'YELLOW', r: 255, g: 255, b: 0 },
    { name: 'GREEN', r: 0, g: 255, b: 0 },
    { name: 'BLUE', r: 0, g: 0, b: 255 },
    { name: 'ORANGE', r: 255, g: 165, b: 0 },
    { name: 'PINK', r: 255, g: 192, b: 203 },
    { name: 'CYAN', r: 0, g: 255, b: 255 },
    { name: 'MAGENTA', r: 255, g: 0, b: 255 },
    { name: 'LIGHT_PURPLE', r: 180, g: 130, b: 255 },
    { name: 'LIGHT_RED', r: 255, g: 150, b: 150 },
    { name: 'LIGHT_YELLOW', r: 255, g: 255, b: 150 },
    { name: 'LIGHT_GREEN', r: 150, g: 255, b: 150 },
    { name: 'LIGHT_BLUE', r: 150, g: 200, b: 255 },
  ];

  let closest = { name: hex, distance: Infinity };
  for (const known of knownColors) {
    const d = Math.sqrt(
      Math.pow(r - known.r, 2) + Math.pow(g - known.g, 2) + Math.pow(b - known.b, 2)
    );
    if (d < closest.distance) {
      closest = { name: known.name, distance: d };
    }
  }

  return closest.distance < 100 ? closest.name : hex;
}
