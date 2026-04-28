import { useState, useEffect, useRef } from 'preact/hooks';
import { formatPreciseTimecode } from '../timecode-utils.js';

/**
 * Parse a timecode string (HH:MM:SS, MM:SS, or raw seconds) to seconds.
 */
function tcToSeconds(tc) {
  if (typeof tc === 'number') return tc;
  if (!tc) return NaN;
  const n = parseFloat(tc);
  // If it doesn't contain ':', it's already seconds
  if (!String(tc).includes(':')) return n;
  const parts = String(tc).replace(',', '.').split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  return n;
}

/**
 * Collect the timecode range (earliest start, latest end) from segment marks
 * that overlap the current selection.
 */
function getSelectionTimecodes(editor) {
  const { from, to } = editor.state.selection;
  if (from === to) return null;

  let earliest = Infinity;
  let latest = -Infinity;

  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const seg = node.marks.find((m) => m.type.name === 'segment');
    if (!seg) return;
    const s = tcToSeconds(seg.attrs.start);
    const e = tcToSeconds(seg.attrs.end);
    if (isFinite(s) && s < earliest) earliest = s;
    if (isFinite(e) && e > latest) latest = e;
  });

  if (!isFinite(earliest) || !isFinite(latest)) return null;
  return { start: formatPreciseTimecode(earliest), end: formatPreciseTimecode(latest) };
}

/**
 * Bubble menu that appears ABOVE the text selection.
 * Horizontal bar with action buttons + timecode range.
 */
export function EditorBubbleMenu({ editor, onHighlight, onAskAI }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [timecodes, setTimecodes] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!editor) return;

    const updateMenu = () => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setVisible(false);
        setTimecodes(null);
        return;
      }

      // Get coords at start of selection for vertical position
      const startCoords = editor.view.coordsAtPos(from);
      const endCoords = editor.view.coordsAtPos(to);
      if (!startCoords) {
        setVisible(false);
        setTimecodes(null);
        return;
      }

      // Horizontal center between start and end of selection
      const centerX = (startCoords.left + endCoords.right) / 2;

      setPosition({
        top: startCoords.top,
        left: centerX,
      });
      setTimecodes(getSelectionTimecodes(editor));
      setVisible(true);
    };

    editor.on('selectionUpdate', updateMenu);
    editor.on('blur', () => setVisible(false));

    return () => {
      editor.off('selectionUpdate', updateMenu);
    };
  }, [editor]);

  if (!visible || !editor) return null;

  const toggleDelete = () => {
    editor.chain().focus().toggleDeleted().run();
  };

  const toggleHighlight = () => {
    if (editor.isActive('highlight', { tagId: null })) {
      editor.chain().focus().unsetHighlightMark().run();
    } else {
      editor.chain().focus().setHighlightMark({
        tagId: null,
        tagName: '',
        color: '#FFBF00',
      }).run();
    }
  };

  return (
    <div
      ref={menuRef}
      className="bubble-menu"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translate(-50%, calc(-100% - 8px))',
        zIndex: 100,
      }}
    >
      <button
        className={`bubble-btn bubble-btn--highlight ${editor.isActive('highlight', { tagId: null }) ? 'active' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); toggleHighlight(); }}
        title="Highlight selection"
      >
        HL
      </button>
      <button
        className={`bubble-btn ${editor.isActive('deleted') ? 'active' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); toggleDelete(); }}
        title="Soft delete (strikethrough)"
      >
        Del
      </button>
      {onHighlight && (
        <button
          className="bubble-btn"
          onMouseDown={(e) => { e.preventDefault(); onHighlight(); }}
          title="Highlight with tag"
        >
          Tag
        </button>
      )}
      {onAskAI && (
        <button
          className="bubble-btn bubble-btn--ai"
          onMouseDown={(e) => { e.preventDefault(); onAskAI(); }}
          title="Ask AI about selection"
        >
          AI
        </button>
      )}
      {timecodes && (
        <span className="bubble-timecodes">
          {timecodes.start} – {timecodes.end}
        </span>
      )}
    </div>
  );
}
