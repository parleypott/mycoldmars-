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
  a.download = `${(transcriptName || 'summary').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-summary.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
