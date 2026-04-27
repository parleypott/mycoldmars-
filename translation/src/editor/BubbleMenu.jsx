import { useState, useEffect, useRef } from 'preact/hooks';

/**
 * Custom bubble menu that positions itself near the text selection.
 * No dependency on @tiptap/extension-bubble-menu.
 */
export function EditorBubbleMenu({ editor, onHighlight, onAskAI }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    if (!editor) return;

    const updateMenu = () => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setVisible(false);
        return;
      }

      // Get selection coordinates
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) {
        setVisible(false);
        return;
      }

      const range = domSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      if (rect.width === 0) {
        setVisible(false);
        return;
      }

      setPosition({
        top: rect.top - 48 + window.scrollY,
        left: rect.left + rect.width / 2,
      });
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

  return (
    <div
      ref={menuRef}
      className="bubble-menu"
      style={{
        position: 'absolute',
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translateX(-50%)',
        zIndex: 100,
      }}
    >
      <button
        className={`bubble-btn ${editor.isActive('deleted') ? 'active' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); toggleDelete(); }}
        title="Soft delete (strikethrough)"
      >
        Delete
      </button>
      {onHighlight && (
        <button
          className="bubble-btn"
          onMouseDown={(e) => { e.preventDefault(); onHighlight(); }}
          title="Highlight with tag"
        >
          Highlight
        </button>
      )}
      {onAskAI && (
        <button
          className="bubble-btn bubble-btn--ai"
          onMouseDown={(e) => { e.preventDefault(); onAskAI(); }}
          title="Ask AI about selection"
        >
          Ask AI
        </button>
      )}
    </div>
  );
}
