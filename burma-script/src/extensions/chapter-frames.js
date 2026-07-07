import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { getEpisode, episodeFlag } from '../episode-config.js';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

const chapterFramesKey = new PluginKey('chapterFrames');
const CHAPTER_FRAMES_REBUILD = 'chapterFramesRebuild';
const EMPTY_STATE = { signature: 'off', decorations: DecorationSet.empty };

function isPalauEpisode() {
  return episodeFlag('chapterFrames');
}

function firstBlockInRow(row) {
  const cell = row?.firstChild;
  if (!cell || cell.type?.name !== 'tableCell') return null;
  return cell.firstChild || null;
}

function chapterRunStartForRow(row) {
  const block = firstBlockInRow(row);
  if (!block) return null;
  if (block.type?.name === 'chapterBlock') {
    return { kind: 'chapter', genre: block.attrs?.genre || 'other' };
  }
  // Scenes do NOT start a new frame — a scene lives INSIDE its chapter's frame (Johnny's model:
  // all the chapter's rows, scenes included, sit within the one big chapter frame). Only real
  // chapterBlocks open a frame run.
  return null;
}

function docHasRunStarts(doc) {
  let found = false;
  doc.forEach((row) => {
    if (!found && row.type?.name === 'tableRow' && chapterRunStartForRow(row)) found = true;
  });
  return found;
}

function buildSignature(doc) {
  if (!isPalauEpisode()) return EMPTY_STATE.signature;
  const parts = [String(doc.childCount)];
  doc.forEach((row, offset, index) => {
    if (row.type?.name !== 'tableRow') {
      parts.push(`x${index}:${row.type?.name || 'unknown'}:${offset}`);
      return;
    }
    const start = chapterRunStartForRow(row);
    if (start) parts.push(`${index}:${start.kind}:${start.genre}`);
  });
  return parts.join('|');
}

// Exported for the headless suite — the frame classes a doc's rows should carry.
export function buildDecorations(doc) {
  if (!isPalauEpisode()) return DecorationSet.empty;

  const rows = [];
  let nextChapterId = 0;
  let currentChapterId = 0;
  let currentGenre = null;

  doc.forEach((row, pos, index) => {
    if (row.type?.name !== 'tableRow') return;
    const start = chapterRunStartForRow(row);
    if (start) {
      nextChapterId += 1;
      currentChapterId = nextChapterId;
      currentGenre = start.genre;
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
  const seenRuns = new Set();
  return Array.from(root.querySelectorAll('.wp-chframe-first')).flatMap((node) => {
    const runHost = node.matches('[data-chapter-run]')
      ? node
      : node.closest('[data-chapter-run]') || node.querySelector('[data-chapter-run]');
    const runId = runHost?.getAttribute('data-chapter-run');
    if (!runId || seenRuns.has(runId)) return [];
    seenRuns.add(runId);
    return [runHost];
  });
}

function chapterGenreLabel(genreId) {
  const genres = Array.isArray(getEpisode()?.genres) ? getEpisode().genres : [];
  const genre = genres.find((entry) => entry?.id === genreId);
  return (genre?.label || '').trim();
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
          const forceRebuild = tr.getMeta(CHAPTER_FRAMES_REBUILD) === true;
          const shouldRecoverFromOff =
            pluginState.signature === EMPTY_STATE.signature
            && docHasRunStarts(tr.doc);
          if (!tr.docChanged && !forceRebuild && !shouldRecoverFromOff) return pluginState;
          const signature = buildSignature(tr.doc);
          if (!forceRebuild && !shouldRecoverFromOff && signature === pluginState.signature) {
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

    })];
  },
});
