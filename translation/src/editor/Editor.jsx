import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState, useCallback } from 'preact/hooks';
import { SpeakerBlock } from './extensions/SpeakerBlock.js';
import { Segment } from './extensions/Segment.js';
import { DeletedMark } from './extensions/DeletedMark.js';
import { HighlightMark } from './extensions/HighlightMark.js';
import { EditorBubbleMenu } from './BubbleMenu.jsx';
import { TagPicker } from './TagPicker.jsx';
import { extractSequenceBase } from '../csv-parser.js';
import { formatPreciseTimecode } from '../timecode-utils.js';

export function TranscriptEditor({ initialContent, onUpdate, projectId, onAskAI, summary, sequenceInfo, speakerColors, speakerMap, onSpeakerMapChange }) {
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState(null);
  const [editValue, setEditValue] = useState('');

  const seqNameRef = sequenceInfo?.sequenceName || '';
  const primarySpeakerRef = sequenceInfo?.primarySpeaker || '';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
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
    editorProps: {
      handleDOMEvents: {
        copy: (view, event) => {
          const sel = view.state.selection;
          if (sel.empty) return false;

          const text = view.state.doc.textBetween(sel.from, sel.to, ' ');
          if (!text.trim()) return false;

          // Find first start and last end timecodes in the selection
          let firstStart = '';
          let lastEnd = '';
          view.state.doc.nodesBetween(sel.from, sel.to, (node) => {
            if (node.isText && node.marks) {
              const segMark = node.marks.find(m => m.type.name === 'segment');
              if (segMark) {
                if (!firstStart && segMark.attrs.start) firstStart = segMark.attrs.start;
                if (segMark.attrs.end) lastEnd = segMark.attrs.end;
              }
            }
          });

          // Format timecodes — detect decimal seconds (from JSON) vs HH:MM:SS (from CSV)
          const isDecimal = (tc) => tc && /^\d+(\.\d+)?$/.test(tc);

          let timecode = '';
          if (firstStart) {
            const startFmt = isDecimal(firstStart) ? formatPreciseTimecode(parseFloat(firstStart)) : firstStart;
            if (lastEnd && lastEnd !== firstStart) {
              const endFmt = isDecimal(lastEnd) ? formatPreciseTimecode(parseFloat(lastEnd)) : lastEnd;
              timecode = `${startFmt} → ${endFmt}`;
            } else {
              timecode = startFmt;
            }
          }

          // Find speaker of the selected block
          let blockSpeaker = '';
          const $pos = view.state.doc.resolve(sel.from);
          for (let d = $pos.depth; d > 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'speakerBlock') {
              blockSpeaker = node.attrs.speaker || '';
              break;
            }
          }

          // Build prefix: primary sequence base + speaker if non-primary
          const seqName = seqNameRef;
          const primaryBase = extractSequenceBase(seqName);
          let clipPrefix = primaryBase || seqName;
          if (blockSpeaker && primarySpeakerRef && blockSpeaker.toUpperCase() !== primarySpeakerRef.toUpperCase()) {
            clipPrefix += ` - ${blockSpeaker.toUpperCase()}`;
          }

          if (clipPrefix || timecode) {
            event.preventDefault();
            const prefix = [clipPrefix, timecode].filter(Boolean).join(' | ');
            event.clipboardData.setData('text/plain', `[${prefix}] ${text.trim()}`);
            return true; // prevent ProseMirror default copy
          }
          return false;
        },
      },
    },
    onUpdate: ({ editor }) => {
      if (onUpdate) onUpdate(editor.getJSON());
    },
  });

  useEffect(() => {
    if (editor && initialContent) {
      const current = JSON.stringify(editor.getJSON());
      const incoming = JSON.stringify(initialContent);
      if (current !== incoming) {
        editor.commands.setContent(initialContent);
      }
    }
  }, [initialContent]);

  // Toggle deleted content visibility
  useEffect(() => {
    const el = document.querySelector('.editor-content');
    if (el) el.classList.toggle('show-deleted', showDeleted);
  }, [showDeleted]);

  // Toggle dismissed blocks visibility
  useEffect(() => {
    const el = document.querySelector('.editor-content');
    if (el) el.classList.toggle('show-dismissed', showDismissed);
  }, [showDismissed]);

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

    let originalText = '';
    let segmentNumber = null;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const segMark = node.marks.find(m => m.type.name === 'segment');
        if (segMark) {
          originalText += (segMark.attrs.originalText || '') + ' ';
          if (!segmentNumber) segmentNumber = segMark.attrs.number;
        }
      }
    });

    onAskAI({ text: text.trim(), originalText: originalText.trim(), segmentNumber });
  }, [editor, onAskAI]);

  function startEditSpeaker(rawName) {
    setEditingSpeaker(rawName);
    setEditValue(speakerMap?.[rawName] || rawName);
  }

  function saveSpeakerEdit() {
    if (editingSpeaker && onSpeakerMapChange) {
      onSpeakerMapChange(editingSpeaker, editValue.trim());
    }
    setEditingSpeaker(null);
  }

  if (!editor) return null;

  // Get unique speakers from speakerMap
  const speakers = Object.entries(speakerMap || {});
  const dateStr = sequenceInfo?.dateFilmed
    ? sequenceInfo.dateFilmed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="transcript-editor">
      {/* Sequence header */}
      {sequenceInfo?.sequenceName && (
        <div className="editor-sequence-header">
          <div className="editor-sequence-name">
            <svg className="editor-premiere-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect width="16" height="16" rx="2" fill="#00005B"/>
              <text x="3" y="12" fill="white" fontSize="10" fontFamily="sans-serif" fontWeight="bold">Pr</text>
            </svg>
            <span>{sequenceInfo.sequenceName}</span>
          </div>
          {dateStr && <div className="editor-sequence-date">{dateStr}</div>}
        </div>
      )}

      {/* Speaker panel */}
      {speakers.length > 0 && (
        <div className="editor-speaker-panel">
          {speakers.map(([raw, clean]) => {
            const color = speakerColors?.[raw] || '#DD2C1E';
            const isEditing = editingSpeaker === raw;
            return (
              <div key={raw} className="editor-speaker-chip">
                <span className="editor-speaker-chip-dot" style={{ background: color }} />
                {isEditing ? (
                  <input
                    className="editor-speaker-chip-input"
                    value={editValue}
                    onInput={e => setEditValue(e.target.value)}
                    onBlur={saveSpeakerEdit}
                    onKeyDown={e => { if (e.key === 'Enter') saveSpeakerEdit(); }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="editor-speaker-chip-name"
                    onClick={() => startEditSpeaker(raw)}
                    title="Click to edit"
                  >
                    {clean}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary collapsible panel */}
      {summary && (
        <div className={`editor-summary-panel ${summaryExpanded ? 'expanded' : ''}`}>
          <button
            className="editor-summary-toggle"
            onClick={() => setSummaryExpanded(!summaryExpanded)}
          >
            <span className="np-eyebrow">Interview Summary</span>
            <span className="editor-summary-arrow">{summaryExpanded ? '−' : '+'}</span>
          </button>
          {summaryExpanded && (
            <div className="editor-summary-content">{summary}</div>
          )}
        </div>
      )}

      {/* Editor toolbar */}
      <div className="editor-toolbar">
        <label className="editor-toolbar-toggle">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={e => setShowDeleted(e.target.checked)}
          />
          <span>Show deleted</span>
        </label>
        <label className="editor-toolbar-toggle">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={e => setShowDismissed(e.target.checked)}
          />
          <span>Show dismissed</span>
        </label>
      </div>

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
