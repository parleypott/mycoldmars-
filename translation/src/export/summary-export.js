/**
 * Export a plain text summary document.
 */
export function exportSummaryText(summaryContent, transcriptName) {
  if (!summaryContent) return;

  const header = `EDITORIAL SUMMARY: ${transcriptName || 'Transcript'}\n${'='.repeat(60)}\n\n`;
  const text = header + summaryContent;

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFilename(transcriptName || 'summary')}-summary.txt`;
  a.click();
  // Revoke after a tick — some browsers (Safari especially) need the URL to
  // outlive the click() call for the download to actually start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Compact filename sanitizer — preserves dots, dashes, underscores; collapses
// runs of replacement chars; drops leading/trailing dashes. Replaces the
// /[^a-z0-9]/gi pattern that produced dash bloat ("My___File" → "my---file").
//
// The trailing strip runs AFTER the 120-char cap, not before: truncating a long
// name can land the cut on a separator ("…title " → "…title-"), and stripping
// first would leave that dangling dash in the download name ("…title--summary.txt").
// Strip-after-slice keeps the documented "no leading/trailing dashes" contract
// even when the cap bites. Byte-identical for every name short enough to skip the cap.
export function safeFilename(name) {
  return String(name || 'untitled')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 120)
    .replace(/^[-.]+|[-.]+$/g, '') || 'untitled';
}
