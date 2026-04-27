import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState, useCallback } from 'preact/hooks';
import { SpeakerBlock } from './extensions/SpeakerBlock.js';
import { Segment } from './extensions/Segment.js';
import { DeletedMark } from './extensions/DeletedMark.js';
import { HighlightMark } from './extensions/HighlightMark.js';
import { EditorBubbleMenu } from './BubbleMenu.jsx';
import { TagPicker } from './TagPicker.jsx';

export function TranscriptEditor({ initialContent, onUpdate, projectId, onAskAI }) {
  const [showTagPicker, setShowTagPicker] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable nodes we don't need
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
      SpeakerBlock,
      Segment,
      DeletedMark,
      HighlightMark,
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      if (onUpdate) onUpdate(editor.getJSON());
    },
  });

  useEffect(() => {
    if (editor && initialContent) {
      // Only set content if editor exists and content differs
      const current = JSON.stringify(editor.getJSON());
      const incoming = JSON.stringify(initialContent);
      if (current !== incoming) {
        editor.commands.setContent(initialContent);
      }
    }
  }, [initialContent]);

  const handleHighlight = useCallback(() => {
    setShowTagPicker(true);
  }, []);

  const handleTagSelect = useCallback((tag) => {
    if (!editor) return;
    editor.chain().focus().setHighlightMark({
      tagId: tag.id,
      tagName: tag.name,
      color: tag.color,
    }).run();
    setShowTagPicker(false);
  }, [editor]);

  const handleAskAI = useCallback(() => {
    if (!editor || !onAskAI) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, ' ');

    // Find original text from segment marks
    let originalText = '';
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const segMark = node.marks.find(m => m.type.name === 'segment');
        if (segMark) {
          originalText += (segMark.attrs.originalText || '') + ' ';
        }
      }
    });

    onAskAI({ text: text.trim(), originalText: originalText.trim() });
  }, [editor, onAskAI]);

  if (!editor) return null;

  return (
    <div className="transcript-editor">
      <EditorBubbleMenu
        editor={editor}
        onHighlight={handleHighlight}
        onAskAI={onAskAI ? handleAskAI : null}
      />
      {showTagPicker && (
        <TagPicker
          projectId={projectId}
          onSelect={handleTagSelect}
          onClose={() => setShowTagPicker(false)}
        />
      )}
      <EditorContent editor={editor} className="editor-content" />
    </div>
  );
}
