// Burma Script Tool — app entry (WP-01).
// A Preact + TipTap word processor for Johnny's Burma script. Loads the real 225
// parsed blocks, builds a TipTap doc, and renders an editable, movable script on
// clean Swiss paper. Working copy persists to localStorage; the blocks-data source
// stays read-only.

import { render } from 'preact';
import { useState } from 'preact/hooks';
import { BurmaEditor, LS_DOC } from './Editor.jsx';
import scriptData from '../sample-blocks.json';

const SOURCE_BLOCKS = scriptData.blocks || [];
const DOC_TITLE = scriptData.title || 'Burma — The Human Element';
const SEQUENCES = scriptData.sequences || [];

function Telem({ t }) {
  if (!t) return null;
  return (
    <div class="wp-telem">
      <span class="wp-t">WORDS <b>{t.words.toLocaleString()}</b></span>
      <span class="wp-t">BLOCKS <b>{t.blocks}</b></span>
      <span class="wp-t">SOT <b>{t.done}/{t.sot}</b></span>
    </div>
  );
}

function App() {
  const [tel, setTel] = useState(null);

  function resetDoc() {
    try { localStorage.removeItem(LS_DOC); } catch {}
    location.reload();
  }

  return (
    <div class="wp-app">
      <header class="wp-bar">
        <span class="wp-model">WP&#8209;01 <b>BURMA</b> · SCRIPT</span>
        <Telem t={tel} />
        <button class="wp-reset" onClick={resetDoc} title="Reset to source script">RESET</button>
      </header>

      <main class="wp-stage">
        <div class="wp-page">
          <div class="wp-doc-head" contenteditable={false}>
            <div class="wp-eyebrow">the human element</div>
            <h1 class="wp-title">{DOC_TITLE}</h1>
            <div class="wp-seq">{SEQUENCES.map(s => s.name).join('  ·  ')}</div>
          </div>
          <BurmaEditor sourceBlocks={SOURCE_BLOCKS} onTelemetry={setTel} />
        </div>
      </main>
    </div>
  );
}

render(<App />, document.getElementById('app'));
