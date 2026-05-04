import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState, useCallback, useRef, useMemo } from 'preact/hooks';
import { SpeakerBlock } from './extensions/SpeakerBlock.js';
import { Segment } from './extensions/Segment.js';
import { DeletedMark } from './extensions/DeletedMark.js';
import { HighlightMark } from './extensions/HighlightMark.js';
import { InterestPlugin, interestPluginKey } from './extensions/InterestPlugin.js';
import { EditorBubbleMenu } from './BubbleMenu.jsx';
import { TagPicker } from './TagPicker.jsx';
import { SummaryView } from '../copilot/SummaryView.jsx';
import { extractSequenceBase } from '../csv-parser.js';
import { formatPreciseTimecode } from '../timecode-utils.js';

export function TranscriptEditor({ initialContent, onUpdate, projectId, onAskAI, onSync, onSequenceNameChange, editorDirty, summary, summaryBullets, interestVotes, onInterestVote, onRegenerateSummary, sequenceInfo, speakerColors, speakerMap, hiddenSpeakers, onSpeakerMapChange }) {
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [editingSeqName, setEditingSeqName] = useState(false);
  const [seqNameValue, setSeqNameValue] = useState('');
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const syncMenuRef = useRef(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [timecodeTooltip, setTimecodeTooltip] = useState(null);
  const [showMarginNotes, setShowMarginNotes] = useState(false);
  const [marginNotePositions, setMarginNotePositions] = useState([]);
  const editorContentRef = useRef(null);
  const [filteredSpeakers, setFilteredSpeakers] = useState(() => {
    if (!hiddenSpeakers || hiddenSpeakers.length === 0) return new Set();
    return new Set(hiddenSpeakers.map(raw => speakerMap?.[raw] || raw));
  });

  const seqNameLatest = useRef(sequenceInfo?.sequenceName || '');
  const primarySpeakerLatest = useRef(sequenceInfo?.primarySpeaker || '');
  seqNameLatest.current = sequenceInfo?.sequenceName || '';
  primarySpeakerLatest.current = sequenceInfo?.primarySpeaker || '';

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
      InterestPlugin,
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
          const seqName = seqNameLatest.current;
          const primaryBase = extractSequenceBase(seqName);
          let clipPrefix = primaryBase || seqName;
          if (blockSpeaker && primarySpeakerLatest.current && blockSpeaker.toUpperCase() !== primarySpeakerLatest.current.toUpperCase()) {
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

  // Dispatch interest votes to ProseMirror plugin
  useEffect(() => {
    if (!editor || !interestVotes) return;
    const tr = editor.state.tr.setMeta(interestPluginKey, interestVotes);
    editor.view.dispatch(tr);
  }, [editor, interestVotes]);

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

  // Speaker filter: inject dynamic CSS to hide filtered speaker blocks
  useEffect(() => {
    let styleEl = document.getElementById('speaker-filter-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'speaker-filter-styles';
      document.head.appendChild(styleEl);
    }
    if (filteredSpeakers.size === 0) {
      styleEl.textContent = '';
    } else {
      const rules = [...filteredSpeakers].map(name => {
        const escaped = CSS.escape(name);
        return `.editor-content [data-speaker-block][data-speaker="${escaped}"] { display: none; }`;
      }).join('\n');
      styleEl.textContent = rules;
    }
    return () => {
      if (styleEl.parentNode) styleEl.textContent = '';
    };
  }, [filteredSpeakers]);

  // Timecode tooltip on selection
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (from === to) { setTimecodeTooltip(null); return; }

      let firstStart = '';
      let lastEnd = '';
      ed.state.doc.nodesBetween(from, to, (node) => {
        if (node.isText && node.marks) {
          const seg = node.marks.find(m => m.type.name === 'segment');
          if (seg) {
            if (!firstStart && seg.attrs.start) firstStart = seg.attrs.start;
            if (seg.attrs.end) lastEnd = seg.attrs.end;
          }
        }
      });

      if (!firstStart) { setTimecodeTooltip(null); return; }

      const fmtShort = (tc) => {
        if (!tc) return '';
        let secs;
        if (/^\d+(\.\d+)?$/.test(tc)) { secs = parseFloat(tc); }
        else {
          const m = tc.match(/(\d+):(\d+):(\d+)/);
          if (m) secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
          else { const m2 = tc.match(/(\d+):(\d+)/); secs = m2 ? parseInt(m2[1]) * 60 + parseInt(m2[2]) : 0; }
        }
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        const pad = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
      };

      const startFmt = fmtShort(firstStart);
      const endFmt = lastEnd && lastEnd !== firstStart ? fmtShort(lastEnd) : '';
      const label = endFmt ? `${startFmt} \u2013 ${endFmt}` : startFmt;

      // Position above the selection start
      const coords = ed.view.coordsAtPos(from);
      const editorRect = ed.view.dom.closest('.editor-content')?.getBoundingClientRect();
      if (!editorRect) { setTimecodeTooltip(null); return; }

      setTimecodeTooltip({
        label,
        top: coords.top - editorRect.top - 22,
        left: coords.left - editorRect.left,
      });
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => editor.off('selectionUpdate', handleSelectionUpdate);
  }, [editor]);

  // Compute interested bullets for margin notes
  const interestedBullets = useMemo(() => {
    if (!showMarginNotes || !summaryBullets || !interestVotes) return [];
    return summaryBullets.filter(b => {
      if (b.segmentStart == null) return false;
      for (let n = b.segmentStart; n <= b.segmentEnd; n++) {
        if (interestVotes[n] === 'interested') return true;
      }
      return false;
    });
  }, [showMarginNotes, summaryBullets, interestVotes]);

  // Measure margin note positions from DOM
  useEffect(() => {
    if (!showMarginNotes || !editor || interestedBullets.length === 0) {
      setMarginNotePositions([]);
      return;
    }

    const measure = () => {
      const container = editorContentRef.current;
      if (!container) return;
      const editorEl = container.querySelector('.tiptap');
      if (!editorEl) return;
      const containerRect = container.getBoundingClientRect();

      const notes = [];
      for (const bullet of interestedBullets) {
        // Find the first segment span matching this bullet's start segment
        const segEl = editorEl.querySelector(`[data-number="${bullet.segmentStart}"]`);
        if (!segEl) continue;
        const blockEl = segEl.closest('[data-speaker-block]');
        if (!blockEl) continue;

        const blockRect = blockEl.getBoundingClientRect();
        const text = (bullet.rawText || '').replace(/\[[\d:–\-\s]+\]\s*/g, '');
        const short = text.length <= 50 ? text : text.slice(0, text.lastIndexOf(' ', 50) || 50) + '…';

        notes.push({
          id: bullet.id,
          top: blockRect.top - containerRect.top,
          text: short,
        });
      }
      setMarginNotePositions(notes);
    };

    // Measure after render
    requestAnimationFrame(measure);

    // Re-measure on scroll within the editor
    const container = editorContentRef.current;
    const tiptap = container?.querySelector('.tiptap');
    if (tiptap) {
      tiptap.addEventListener('scroll', measure, { passive: true });
      return () => tiptap.removeEventListener('scroll', measure);
    }
  }, [showMarginNotes, editor, interestedBullets]);

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
    const segmentNumbers = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const segMark = node.marks.find(m => m.type.name === 'segment');
        if (segMark) {
          originalText += (segMark.attrs.originalText || '') + ' ';
          if (!segmentNumber) segmentNumber = segMark.attrs.number;
          if (segMark.attrs.number != null && !segmentNumbers.includes(segMark.attrs.number)) {
            segmentNumbers.push(segMark.attrs.number);
          }
        }
      }
    });

    onAskAI({ text: text.trim(), originalText: originalText.trim(), segmentNumber, segmentNumbers });
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

  // Close sync dropdown on outside click
  useEffect(() => {
    if (!syncMenuOpen) return;
    const handleClick = (e) => {
      if (syncMenuRef.current && !syncMenuRef.current.contains(e.target)) {
        setSyncMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [syncMenuOpen]);

  const handleSyncSelected = useCallback(() => {
    if (!editor || !onSync) return;
    const { from, to } = editor.state.selection;
    if (from === to) return; // no selection
    const segNums = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const seg = node.marks.find(m => m.type.name === 'segment');
        if (seg && seg.attrs.number != null && !segNums.includes(seg.attrs.number)) {
          segNums.push(seg.attrs.number);
        }
      }
    });
    if (segNums.length > 0) {
      onSync(segNums);
    }
    setSyncMenuOpen(false);
  }, [editor, onSync]);

  // Smart Sync — for when the user has pasted a polished rewrite over one or
  // more segments. The paste destroys segment marks and Sync Selected would
  // drop the new text. Smart Sync takes whatever's in the selection as the
  // new content for the segment range it covers, and re-distributes the
  // words across those segments by their original timing.
  const handleSmartSyncSelected = useCallback(() => {
    if (!editor || !onSync) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;

    const segNums = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const seg = node.marks.find(m => m.type.name === 'segment');
        if (seg && seg.attrs.number != null && !segNums.includes(seg.attrs.number)) {
          segNums.push(seg.attrs.number);
        }
      }
    });

    const fullText = editor.state.doc.textBetween(from, to, ' ').trim();
    if (segNums.length > 0 && fullText) {
      onSync({ kind: 'smart', segNums, fullText });
    }
    setSyncMenuOpen(false);
  }, [editor, onSync]);

  if (!editor) return null;

  // Get unique speakers from speakerMap, excluding hidden (generic) speakers.
  // When multiple speakers share the same clean name (e.g. lots of generic
  // "Speaker"), auto-number them so chips read Speaker 01, Speaker 02… —
  // otherwise the editor shows a wall of identical pills.
  const hiddenSet = new Set(hiddenSpeakers || []);
  const rawSpeakers = Object.entries(speakerMap || {}).filter(([raw]) => !hiddenSet.has(raw));
  const nameCounts = rawSpeakers.reduce((acc, [, clean]) => {
    acc[clean] = (acc[clean] || 0) + 1;
    return acc;
  }, {});
  const seenIndex = {};
  const speakers = rawSpeakers.map(([raw, clean]) => {
    if (nameCounts[clean] > 1) {
      seenIndex[clean] = (seenIndex[clean] || 0) + 1;
      return [raw, clean, `${clean} ${String(seenIndex[clean]).padStart(2, '0')}`];
    }
    return [raw, clean, clean];
  });
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
            {editingSeqName ? (
              <input
                className="editor-sequence-name-input"
                value={seqNameValue}
                onInput={e => setSeqNameValue(e.target.value)}
                onBlur={() => {
                  setEditingSeqName(false);
                  if (onSequenceNameChange) onSequenceNameChange(seqNameValue.trim());
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    setEditingSeqName(false);
                    if (onSequenceNameChange) onSequenceNameChange(seqNameValue.trim());
                  }
                }}
                autoFocus
              />
            ) : (
              <>
                <span>{sequenceInfo.sequenceName}</span>
                <button
                  className="editor-sequence-edit-btn"
                  onClick={() => { setSeqNameValue(sequenceInfo.sequenceName); setEditingSeqName(true); }}
                  title="Edit sequence name"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1" fill="none"/>
                  </svg>
                </button>
              </>
            )}
          </div>
          {dateStr && <div className="editor-sequence-date">{dateStr}</div>}
        </div>
      )}

      {/* Speaker panel */}
      {speakers.length > 0 && (
        <div className="editor-speaker-panel">
          {speakers.map(([raw, clean, display]) => {
            const color = speakerColors?.[raw] || '#DD2C1E';
            const isEditing = editingSpeaker === raw;
            const isFiltered = filteredSpeakers.has(clean);
            const toggle = (e) => {
              e.stopPropagation();
              const next = new Set(filteredSpeakers);
              if (isFiltered) next.delete(clean); else next.add(clean);
              setFilteredSpeakers(next);
            };
            return (
              <button
                type="button"
                key={raw}
                className={`editor-speaker-chip ${isFiltered ? 'editor-speaker-chip--filtered' : ''}`}
                onClick={toggle}
                title={isFiltered ? 'Show this speaker' : 'Hide this speaker'}
                aria-pressed={!isFiltered}
              >
                <span
                  className="editor-speaker-chip-dot"
                  style={{ background: isFiltered ? 'transparent' : color, borderColor: color }}
                />
                {isEditing ? (
                  <input
                    className="editor-speaker-chip-input"
                    value={editValue}
                    onInput={e => setEditValue(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={saveSpeakerEdit}
                    onKeyDown={e => { if (e.key === 'Enter') saveSpeakerEdit(); }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="editor-speaker-chip-name"
                    onDoubleClick={(e) => { e.stopPropagation(); startEditSpeaker(raw); }}
                    title="Double-click to rename"
                  >
                    {display}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary collapsible panel */}
      {summary && (
        <div className={`editor-summary-panel ${summaryExpanded ? 'expanded' : ''}`}>
          <div className="editor-summary-header">
            <button
              className="editor-summary-toggle"
              onClick={() => setSummaryExpanded(!summaryExpanded)}
            >
              <span className="np-eyebrow">Interview Summary</span>
              <span className="editor-summary-arrow">{summaryExpanded ? '−' : '+'}</span>
            </button>
            {summaryExpanded && onRegenerateSummary && (
              <button
                className="editor-summary-regen-btn"
                onClick={onRegenerateSummary}
                title="Regenerate summary"
              >
                Regenerate
              </button>
            )}
          </div>
          {summaryExpanded && (
            <SummaryView
              content={summary}
              loading={!summary && !!onRegenerateSummary}
              bullets={summaryBullets}
              interestVotes={interestVotes}
              onVote={onInterestVote}
            />
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
        {summaryBullets && summaryBullets.length > 0 && (
          <label className="editor-toolbar-toggle editor-toolbar-toggle--margin">
            <input
              type="checkbox"
              checked={showMarginNotes}
              onChange={e => setShowMarginNotes(e.target.checked)}
            />
            <span>Margin notes</span>
          </label>
        )}
        {onSync && (
          <div className="editor-sync-wrap" ref={syncMenuRef}>
            <button
              className="editor-sync-btn"
              data-dirty={editorDirty ? 'true' : 'false'}
              onClick={() => setSyncMenuOpen(!syncMenuOpen)}
              title="Sync editor text back to translations for SRT export"
            >
              Sync
            </button>
            {syncMenuOpen && (
              <div className="editor-sync-dropdown">
                <button
                  className="editor-sync-dropdown-item"
                  onClick={() => { onSync(); setSyncMenuOpen(false); }}
                >
                  Sync All
                </button>
                <button
                  className="editor-sync-dropdown-item"
                  onClick={handleSyncSelected}
                  disabled={!editor || editor.state.selection.from === editor.state.selection.to}
                >
                  Sync Selected
                </button>
                <button
                  className="editor-sync-dropdown-item editor-sync-dropdown-item--smart"
                  onClick={handleSmartSyncSelected}
                  disabled={!editor || editor.state.selection.from === editor.state.selection.to}
                  title="Replace covered segments with the selected text, distributing words by original timing. Use after pasting a clean rewrite."
                >
                  Smart Sync (rewrite)
                  <span className="editor-sync-dropdown-sub">redistribute selection by timing</span>
                </button>
              </div>
            )}
          </div>
        )}
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
      <div
        ref={editorContentRef}
        className={`editor-content ${showMarginNotes ? 'has-margin-notes' : ''}`}
        style={{ position: 'relative' }}
      >
        {timecodeTooltip && (
          <div
            className="editor-timecode-tooltip"
            style={{ top: timecodeTooltip.top + 'px', left: timecodeTooltip.left + 'px' }}
          >
            {timecodeTooltip.label}
          </div>
        )}
        {showMarginNotes && marginNotePositions.map(note => (
          <div
            key={note.id}
            className="margin-note"
            style={{ top: note.top + 'px' }}
          >
            {note.text}
          </div>
        ))}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
