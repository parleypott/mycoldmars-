import { useState, useEffect, useRef } from 'preact/hooks';
import { formatPreciseTimecode } from '../timecode-utils.js';

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
    const s = parseFloat(seg.attrs.start);
    const e = parseFloat(seg.attrs.end);
    if (isFinite(s) && s < earliest) earliest = s;
    if (isFinite(e) && e > latest) latest = e;
  });

  if (!isFinite(earliest) || !isFinite(latest)) return null;
  return { start: formatPreciseTimecode(earliest), end: formatPreciseTimecode(latest) };
}

/**
 * Custom bubble menu that positions itself near the text selection.
 * Uses fixed positioning relative to the viewport for reliable placement.
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

      // Get the editor's coordinate for the start of selection
      const coords = editor.view.coordsAtPos(from);
      if (!coords) {
        setVisible(false);
        setTimecodes(null);
        return;
      }

      // Position menu to the left of the text
      const editorEl = editor.view.dom.closest('.transcript-editor');
      const editorRect = editorEl?.getBoundingClientRect();
      const leftEdge = editorRect ? editorRect.left : coords.left;

      setPosition({
        top: coords.top,
        left: Math.max(8, leftEdge - 8),
        selLeft: coords.left,
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
    <>
      {timecodes && (
        <div
          className="bubble-timecodes"
          style={{
            position: 'fixed',
            top: `${position.top}px`,
            left: `${position.selLeft}px`,
            transform: 'translateY(calc(-100% - 4px))',
            zIndex: 101,
          }}
        >
          {timecodes.start} – {timecodes.end}
        </div>
      )}
      <div
        ref={menuRef}
        className="bubble-menu"
        style={{
          position: 'fixed',
          top: `${position.top}px`,
          left: `${position.left}px`,
          transform: 'translate(-100%, -4px)',
          zIndex: 100,
        }}
      >
        <button
          className={`bubble-btn ${editor.isActive('deleted') ? 'active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); toggleDelete(); }}
          title="Soft delete (strikethrough)"
        >
          Del
        </button>
        <button
          className={`bubble-btn bubble-btn--highlight ${editor.isActive('highlight', { tagId: null }) ? 'active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); toggleHighlight(); }}
          title="Highlight selection"
        >
          HL
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
      </div>
    </>
  );
}
