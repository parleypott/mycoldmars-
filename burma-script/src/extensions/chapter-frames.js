import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { getEpisode } from '../episode-config.js';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

const chapterFramesKey = new PluginKey('chapterFrames');
const EMPTY_STATE = { signature: 'off', decorations: DecorationSet.empty };

function isPalauEpisode() {
  return getEpisode()?.id === 'palau';
}

function firstBlockInRow(row) {
  const cell = row?.firstChild;
  if (!cell || cell.type?.name !== 'tableCell') return null;
  return cell.firstChild || null;
}

function chapterGenreForRow(row) {
  const block = firstBlockInRow(row);
  if (!block || block.type?.name !== 'chapterBlock') return null;
  return block.attrs?.genre || 'other';
}

function buildSignature(doc) {
  if (!isPalauEpisode()) return EMPTY_STATE.signature;
  const parts = [String(doc.childCount)];
  doc.forEach((row, offset, index) => {
    if (row.type?.name !== 'tableRow') {
      parts.push(`x${index}:${row.type?.name || 'unknown'}:${offset}`);
      return;
    }
    const genre = chapterGenreForRow(row);
    if (genre) parts.push(`${index}:${genre}`);
  });
  return parts.join('|');
}

function buildDecorations(doc) {
  if (!isPalauEpisode()) return DecorationSet.empty;

  const rows = [];
  let nextChapterId = 0;
  let currentChapterId = 0;
  let currentGenre = null;

  doc.forEach((row, pos, index) => {
    if (row.type?.name !== 'tableRow') return;
    const genre = chapterGenreForRow(row);
    if (genre) {
      nextChapterId += 1;
      currentChapterId = nextChapterId;
      currentGenre = genre;
    }
    rows.push({
      index,
      pos,
      nodeSize: row.nodeSize,
      chapterId: currentChapterId || null,
      genre: currentGenre || null,
    });
  });

  const decorations = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.chapterId || !row.genre) continue;
    const prev = rows[i - 1];
    const next = rows[i + 1];
    const isFirst = !prev || prev.chapterId !== row.chapterId;
    const isLast = !next || next.chapterId !== row.chapterId;
    const classes = ['wp-chframe'];
    if (isFirst) classes.push('wp-chframe-first');
    if (isLast) classes.push('wp-chframe-last');
    if (!isFirst && !isLast) classes.push('wp-chframe-mid');
    decorations.push(Decoration.node(row.pos, row.pos + row.nodeSize, {
      'data-chapter-run': String(row.chapterId),
      'data-chapter-genre': row.genre,
      class: classes.join(' '),
    }));
  }

  return DecorationSet.create(doc, decorations);
}

function createPluginState(doc) {
  if (!isPalauEpisode()) return EMPTY_STATE;
  return {
    signature: buildSignature(doc),
    decorations: buildDecorations(doc),
  };
}

function readChapterRows(root) {
  const seen = new Set();
  return Array.from(root.querySelectorAll('.wp-chframe-first')).flatMap((node) => {
    const runHost = node.matches('[data-chapter-run]')
      ? node
      : node.closest('[data-chapter-run]') || node.querySelector('[data-chapter-run]');
    if (!runHost?.getAttribute('data-chapter-run') || seen.has(node)) return [];
    seen.add(node);
    return [node];
  });
}

function chapterGenreLabel(genreId) {
  const genres = Array.isArray(getEpisode()?.genres) ? getEpisode().genres : [];
  const genre = genres.find((entry) => entry?.id === genreId);
  return (genre?.label || '').trim();
}

function shortChapterClause(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const clause = clean
    .replace(/^CH\b[:\s-]*/i, '')
    .replace(/^[A-Z ]+\b(?=\s+\d+\b)/, (hit) => hit.trim())
    .trim();
  const cut = clause.match(/^(.{1,36}?)(?:[.:;!?]\s|$)/);
  if (cut?.[1]) return cut[1].trim();
  return clause.split(/\s{2,}|\s[-–—]\s|\s\(/)[0].trim();
}

function chapterTitleForRow(row, index) {
  const genreLabel = chapterGenreLabel(row.getAttribute('data-chapter-genre'));
  if (genreLabel) return genreLabel;
  const text = row.querySelector('[data-chapter] .wp-body')?.textContent || row.querySelector('[data-chapter]')?.textContent || '';
  const short = shortChapterClause(text);
  return short || `Chapter ${index + 1}`;
}

function createSidebarView(editorView) {
  if (!isPalauEpisode() || typeof window === 'undefined' || typeof document === 'undefined') {
    return { update() {}, destroy() {} };
  }

  const host = editorView.dom.closest('.wp-page') || document.body;
  const dom = el('aside', 'wp-chapter-sidebar', { 'data-chapter-sidebar': '', contenteditable: 'false', 'aria-hidden': 'true' });
  const counter = el('div', 'wp-chapter-sidebar-count');
  const title = el('div', 'wp-chapter-sidebar-title');
  dom.appendChild(counter);
  dom.appendChild(title);
  host.appendChild(dom);

  let rows = [];
  let rafId = 0;
  let destroyed = false;

  const paint = () => {
    if (destroyed) return;
    if (!rows.length) {
      dom.hidden = true;
      counter.textContent = '';
      title.textContent = '';
      return;
    }
    const band = Math.max(88, window.innerHeight * 0.24);
    let activeIndex = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect();
      if (rect.top <= band) activeIndex = i;
      if (rect.top > band) break;
    }
    dom.hidden = false;
    counter.textContent = `${activeIndex + 1} / ${rows.length}`;
    title.textContent = chapterTitleForRow(rows[activeIndex], activeIndex);
  };

  const schedulePaint = () => {
    if (destroyed || rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      paint();
    });
  };

  const refreshRows = () => {
    rows = readChapterRows(editorView.dom);
    schedulePaint();
  };

  const onScroll = () => schedulePaint();
  const onResize = () => schedulePaint();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  refreshRows();
  queueMicrotask(refreshRows);
  window.requestAnimationFrame(refreshRows);

  return {
    update(view, prevState) {
      if (prevState.doc !== view.state.doc) refreshRows();
      else schedulePaint();
    },
    destroy() {
      destroyed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      dom.remove();
    },
  };
}

export const ChapterFrames = Extension.create({
  name: 'chapterFrames',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: chapterFramesKey,
      state: {
        init: (_, state) => createPluginState(state.doc),
        apply(tr, pluginState) {
          if (!isPalauEpisode()) return pluginState === EMPTY_STATE ? pluginState : EMPTY_STATE;
          if (!tr.docChanged) return pluginState;
          const signature = buildSignature(tr.doc);
          if (signature === pluginState.signature) {
            const mapped = pluginState.decorations.map(tr.mapping, tr.doc);
            if (mapped === pluginState.decorations) return pluginState;
            return { ...pluginState, decorations: mapped };
          }
          return {
            signature,
            decorations: buildDecorations(tr.doc),
          };
        },
      },
      props: {
        decorations(state) {
          return chapterFramesKey.getState(state)?.decorations || DecorationSet.empty;
        },
      },
      view(editorView) {
        return createSidebarView(editorView);
      },
    })];
  },
});
