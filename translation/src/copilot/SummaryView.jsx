export function SummaryView({ content, loading }) {
  if (loading && !content) {
    return <div className="summary-loading">Generating summary...</div>;
  }

  if (!content) {
    return <div className="summary-empty">No summary generated yet.</div>;
  }

  // Simple markdown-ish rendering: headers, bold, lists
  const lines = content.split('\n');
  const html = lines.map(line => {
    if (line.startsWith('## ')) return `<h3>${line.slice(3)}</h3>`;
    if (line.startsWith('# ')) return `<h2>${line.slice(2)}</h2>`;
    if (line.startsWith('**') && line.endsWith('**')) return `<h4>${line.slice(2, -2)}</h4>`;
    if (line.startsWith('- ')) return `<li>${formatInline(line.slice(2))}</li>`;
    if (line.match(/^\d+\.\s/)) return `<li>${formatInline(line.replace(/^\d+\.\s/, ''))}</li>`;
    if (!line.trim()) return '<br/>';
    return `<p>${formatInline(line)}</p>`;
  }).join('');

  return (
    <div className="summary-content" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function formatInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/"(.+?)"/g, '<q>$1</q>');
}
