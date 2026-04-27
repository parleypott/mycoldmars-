/**
 * Generate a printable HTML document of highlights grouped by tag.
 * Opens in a new window for the user to print/save as PDF.
 */
export function exportHighlightsPDF(highlights, tags, transcriptName) {
  // Group highlights by tag
  const byTag = {};
  const untagged = [];

  for (const h of highlights) {
    if (h.tagName) {
      if (!byTag[h.tagName]) byTag[h.tagName] = { color: h.color || '#DD2C1E', items: [] };
      byTag[h.tagName].items.push(h);
    } else {
      untagged.push(h);
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Highlights — ${esc(transcriptName || 'Transcript')}</title>
  <style>
    body { font-family: 'Courier New', monospace; max-width: 700px; margin: 40px auto; padding: 0 20px; font-size: 13px; line-height: 1.6; color: #121118; }
    h1 { font-family: Georgia, serif; font-size: 28px; font-weight: normal; margin-bottom: 8px; }
    h2 { font-family: Georgia, serif; font-size: 20px; font-weight: normal; margin-top: 32px; padding-bottom: 8px; border-bottom: 1px solid #ccc; }
    .meta { font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin-bottom: 32px; }
    .tag-section { margin-bottom: 24px; }
    .tag-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
    .highlight-item { margin-bottom: 16px; padding-left: 16px; border-left: 3px solid #ccc; }
    .highlight-text { margin-bottom: 4px; }
    .highlight-original { font-style: italic; color: #666; font-size: 12px; }
    .highlight-meta { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.1em; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <h1>${esc(transcriptName || 'Transcript')} — Highlights</h1>
  <div class="meta">${highlights.length} highlight${highlights.length !== 1 ? 's' : ''} &middot; ${Object.keys(byTag).length} tag${Object.keys(byTag).length !== 1 ? 's' : ''}</div>

  ${Object.entries(byTag).map(([tagName, { color, items }]) => `
    <div class="tag-section">
      <h2><span class="tag-dot" style="background:${color}"></span>${esc(tagName)}</h2>
      ${items.map(h => renderHighlight(h)).join('')}
    </div>
  `).join('')}

  ${untagged.length > 0 ? `
    <div class="tag-section">
      <h2>Untagged</h2>
      ${untagged.map(h => renderHighlight(h)).join('')}
    </div>
  ` : ''}
</body>
</html>`;

  // Open in new window
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

function renderHighlight(h) {
  return `
    <div class="highlight-item" style="border-color: ${h.color || '#ccc'}">
      <div class="highlight-text">${esc(h.textPreview)}</div>
      ${h.originalTextPreview ? `<div class="highlight-original">${esc(h.originalTextPreview)}</div>` : ''}
      ${h.note ? `<div class="highlight-meta">Note: ${esc(h.note)}</div>` : ''}
    </div>
  `;
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
