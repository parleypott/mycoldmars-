import { useState, useRef, useEffect, useCallback } from 'preact/hooks';

export function SummaryView({ content, loading, bullets, interestVotes, onVote }) {
  const [popup, setPopup] = useState(null);
  const [selectedBulletIds, setSelectedBulletIds] = useState([]);
  const containerRef = useRef(null);
  const popupRef = useRef(null);

  if (loading && !content) {
    return <div className="summary-loading">Generating summary...</div>;
  }

  if (!content) {
    return <div className="summary-empty">No summary generated yet.</div>;
  }

  // Close popup on outside click
  useEffect(() => {
    if (!popup) return;
    const handleClick = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setPopup(null);
        setSelectedBulletIds([]);
      }
    };
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [popup]);

  const handleMouseUp = useCallback((e) => {
    if (!bullets || bullets.length === 0) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const container = containerRef.current;
    if (!container) return;

    // Find which bullet <li> elements intersect the selection
    const lis = container.querySelectorAll('li[data-bullet-id]');
    const hitIds = [];
    for (const li of lis) {
      if (range.intersectsNode(li)) {
        hitIds.push(parseInt(li.dataset.bulletId));
      }
    }

    if (hitIds.length === 0) return;

    setSelectedBulletIds(hitIds);

    // Position popup near the end of selection
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setPopup({
      top: rect.bottom - containerRect.top + 4,
      left: rect.left - containerRect.left,
    });
  }, [bullets]);

  const handleVote = useCallback((type) => {
    if (!bullets || selectedBulletIds.length === 0 || !onVote) return;

    // Collect all segment numbers from selected bullets
    const segNums = [];
    for (const id of selectedBulletIds) {
      const bullet = bullets.find(b => b.id === id);
      if (bullet && bullet.segmentStart != null) {
        for (let n = bullet.segmentStart; n <= bullet.segmentEnd; n++) {
          if (!segNums.includes(n)) segNums.push(n);
        }
      }
    }

    if (segNums.length > 0) {
      onVote(segNums, type);
    }

    setPopup(null);
    setSelectedBulletIds([]);
    window.getSelection()?.removeAllRanges();
  }, [bullets, selectedBulletIds, onVote]);

  // Determine vote status for a bullet
  function getBulletVoteStatus(bullet) {
    if (!interestVotes || bullet.segmentStart == null) return null;
    let hasInterested = false;
    let hasNotInterested = false;
    for (let n = bullet.segmentStart; n <= bullet.segmentEnd; n++) {
      const v = interestVotes[n];
      if (v === 'interested') hasInterested = true;
      if (v === 'not-interested') hasNotInterested = true;
    }
    if (hasInterested && !hasNotInterested) return 'interested';
    if (hasNotInterested && !hasInterested) return 'not-interested';
    if (hasInterested && hasNotInterested) return 'mixed';
    return null;
  }

  // Structured bullet rendering
  if (bullets && bullets.length > 0) {
    // Group bullets by section
    let lastSection = null;
    const elements = [];
    for (const bullet of bullets) {
      const sectionLabel = bullet.sectionTitleEnriched || bullet.sectionTitle;
      if (sectionLabel && sectionLabel !== lastSection) {
        elements.push(
          <h4 key={`section-${bullet.id}`} className="summary-section-header">
            {sectionLabel}
          </h4>
        );
        lastSection = sectionLabel;
      }
      const status = getBulletVoteStatus(bullet);
      const cls = status ? `summary-bullet summary-bullet--${status}` : 'summary-bullet';
      const text = bullet.enrichedText || bullet.rawText;
      elements.push(
        <li
          key={bullet.id}
          className={cls}
          data-bullet-id={bullet.id}
          data-seg-start={bullet.segmentStart}
          data-seg-end={bullet.segmentEnd}
        >
          <span dangerouslySetInnerHTML={{ __html: formatInline(text) }} />
        </li>
      );
    }

    return (
      <div className="summary-content" ref={containerRef} onMouseUp={handleMouseUp} style={{ position: 'relative' }}>
        <ul className="summary-bullet-list">
          {elements}
        </ul>

        {popup && (
          <div
            ref={popupRef}
            className="interest-popup"
            style={{ top: popup.top + 'px', left: popup.left + 'px' }}
          >
            <button className="interest-popup-btn interest-popup-btn--interested" onClick={() => handleVote('interested')}>
              Interested
            </button>
            <button className="interest-popup-btn interest-popup-btn--not-interested" onClick={() => handleVote('not-interested')}>
              Not interested
            </button>
            <button className="interest-popup-btn interest-popup-btn--clear" onClick={() => handleVote(null)}>
              Clear
            </button>
          </div>
        )}
      </div>
    );
  }

  // Fallback: plain rendering when no structured bullets
  const lines = content.split('\n');
  const html = lines.map(line => {
    if (line.startsWith('## ')) return `<h3>${line.slice(3)}</h3>`;
    if (line.startsWith('# ')) return `<h2>${line.slice(2)}</h2>`;
    if (line.startsWith('**') && line.endsWith('**')) return `<h4>${line.slice(2, -2)}</h4>`;
    if (line.startsWith('- ') || line.startsWith('• ')) return `<li>${formatInline(line.slice(2))}</li>`;
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
