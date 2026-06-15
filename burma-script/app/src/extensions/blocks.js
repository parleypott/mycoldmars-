// Burma Script Tool — custom ProseMirror NODES, one per block type.
// MIRRORS translation/src/editor/extensions/SpeakerBlock.js: each is a Node.create
// with group:'block', content:'paragraph+' (editable prose inside), addAttributes for
// the metadata, and renderHTML emitting a calm Swiss structure. The "0" hole is where
// the editable paragraph content goes.
//
// DESIGN LAW: blocks share ONE rhythm. Differentiation = node class + tiny gutter marks,
// never loud colored boxes. SOT/broll render the TIMECODE as the hero element.

import { Node, mergeAttributes } from '@tiptap/core';

const baseAttrs = () => ({ blockId: { default: null } });

// --- CHAPTER — quiet weighted heading. Genre is a FAINT gutter mark only. ---
export const ChapterBlock = Node.create({
  name: 'chapterBlock',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return { ...baseAttrs(), genre: { default: 'other' } };
  },
  parseHTML() { return [{ tag: 'section[data-chapter]' }]; },
  renderHTML({ node }) {
    return ['section', mergeAttributes({
      'data-chapter': '',
      'data-genre': node.attrs.genre || 'other',
      'data-block-id': node.attrs.blockId || '',
      class: 'wp-chapter',
    }), ['div', { class: 'wp-chapter-inner' }, 0]];
  },
});

// --- SCENE — quieter sub-heading ---
export const SceneBlock = Node.create({
  name: 'sceneBlock',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'section[data-scene]' }]; },
  renderHTML({ node }) {
    return ['section', mergeAttributes({
      'data-scene': '',
      'data-block-id': node.attrs.blockId || '',
      class: 'wp-scene',
    }), ['div', { class: 'wp-scene-inner' }, 0]];
  },
});

// --- VO — clean editable prose. status = tiny 3-state footprint in the gutter ---
export const VoBlock = Node.create({
  name: 'voBlock',
  group: 'block',
  content: 'paragraph+',
  addAttributes() {
    return { ...baseAttrs(), status: { default: 'todo' } };
  },
  parseHTML() { return [{ tag: 'div[data-vo]' }]; },
  renderHTML({ node }) {
    const status = node.attrs.status || 'todo';
    return ['div', mergeAttributes({
      'data-vo': '',
      'data-status': status,
      'data-block-id': node.attrs.blockId || '',
      class: 'wp-block wp-vo',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' },
        ['span', { class: 'wp-kind' }, 'VO'],
        ['button', { class: 'wp-vodot', 'data-status': status, title: 'VO status', contenteditable: 'false' }],
      ],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
});

// --- ONCAM — editable prose, marked on-camera ---
export const OncamBlock = Node.create({
  name: 'oncamBlock',
  group: 'block',
  content: 'paragraph+',
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-oncam]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-oncam': '',
      'data-block-id': node.attrs.blockId || '',
      class: 'wp-block wp-oncam',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' }, ['span', { class: 'wp-kind' }, 'OC']],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
});

// --- SOT — the editorial workhorse. TIMECODE IS THE HERO. icon-only copy. done-tick. ---
export const SotBlock = Node.create({
  name: 'sotBlock',
  group: 'block',
  content: 'paragraph+',
  addAttributes() {
    return {
      ...baseAttrs(),
      timecode: { default: '' },
      day: { default: null },
      ambiguous: { default: false },
      speaker: { default: '' },
      done: { default: false },
    };
  },
  parseHTML() { return [{ tag: 'div[data-sot]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    const head = ['div', { class: 'wp-tc-head', contenteditable: 'false' }];
    head.push(['span', { class: 'wp-tc' + (a.ambiguous ? ' wp-tc-amb' : '') }, a.timecode || '—:—:—:—']);
    head.push(['span', { class: 'wp-day' }, a.ambiguous ? 'DAY ?' : (a.day ? 'DAY ' + a.day : '')]);
    if (a.speaker) head.push(['span', { class: 'wp-speaker' }, a.speaker]);
    head.push(['span', { class: 'wp-spacer' }]);
    head.push(['button', { class: 'wp-copy', title: 'Copy timecode', 'data-tc': a.timecode || '' }, '⧉']);
    head.push(['button', { class: 'wp-done' + (a.done ? ' is-done' : ''), title: 'Mark done' }, '✓']);
    return ['div', mergeAttributes({
      'data-sot': '',
      'data-block-id': a.blockId || '',
      'data-done': a.done ? '1' : '0',
      class: 'wp-block wp-sot' + (a.done ? ' is-done' : ''),
    }), head, ['div', { class: 'wp-body' }, 0]];
  },
});

// --- B-ROLL — same hero timecode, lighter speaker ---
export const BrollBlock = Node.create({
  name: 'brollBlock',
  group: 'block',
  content: 'paragraph+',
  addAttributes() {
    return {
      ...baseAttrs(),
      timecode: { default: '' },
      day: { default: null },
      ambiguous: { default: false },
      done: { default: false },
    };
  },
  parseHTML() { return [{ tag: 'div[data-broll]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    const head = ['div', { class: 'wp-tc-head', contenteditable: 'false' }];
    head.push(['span', { class: 'wp-kind wp-kind-broll' }, 'B-ROLL']);
    head.push(['span', { class: 'wp-tc' + (a.ambiguous ? ' wp-tc-amb' : '') }, a.timecode || '—:—:—:—']);
    head.push(['span', { class: 'wp-day' }, a.ambiguous ? 'DAY ?' : (a.day ? 'DAY ' + a.day : '')]);
    head.push(['span', { class: 'wp-spacer' }]);
    head.push(['button', { class: 'wp-copy', title: 'Copy timecode', 'data-tc': a.timecode || '' }, '⧉']);
    head.push(['button', { class: 'wp-done' + (a.done ? ' is-done' : ''), title: 'Mark done' }, '✓']);
    return ['div', mergeAttributes({
      'data-broll': '',
      'data-block-id': a.blockId || '',
      'data-done': a.done ? '1' : '0',
      class: 'wp-block wp-broll' + (a.done ? ' is-done' : ''),
    }), head, ['div', { class: 'wp-body' }, 0]];
  },
});

// --- SERVICE (map-need / archive-req) — calm dashed utility block ---
export const ServiceBlock = Node.create({
  name: 'serviceBlock',
  group: 'block',
  content: 'paragraph+',
  addAttributes() {
    return { ...baseAttrs(), kind: { default: 'map-need' }, label: { default: '' } };
  },
  parseHTML() { return [{ tag: 'div[data-service]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes({
      'data-service': '',
      'data-kind': a.kind,
      'data-block-id': a.blockId || '',
      class: 'wp-block wp-service',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' },
        ['span', { class: 'wp-kind' }, a.kind === 'archive-req' ? 'ARCHIVE' : 'MAP'],
      ],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
});

// --- NOTE / JH-NOTE — margin-voice aside ---
export const NoteBlock = Node.create({
  name: 'noteBlock',
  group: 'block',
  content: 'paragraph+',
  addAttributes() { return { ...baseAttrs(), kind: { default: 'note' } }; },
  parseHTML() { return [{ tag: 'div[data-note]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes({
      'data-note': '',
      'data-kind': a.kind,
      'data-block-id': a.blockId || '',
      class: 'wp-block wp-note',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' }, ['span', { class: 'wp-kind' }, a.kind === 'jh-note' ? 'JH' : 'NOTE']],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
});

// --- BIN — unplaced holding material, quietest of all ---
export const BinBlock = Node.create({
  name: 'binBlock',
  group: 'block',
  content: 'paragraph+',
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-bin]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-bin': '',
      'data-block-id': node.attrs.blockId || '',
      class: 'wp-block wp-bin',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' }, ['span', { class: 'wp-kind' }, 'BIN']],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
});

export const BURMA_NODES = [
  ChapterBlock, SceneBlock, VoBlock, OncamBlock,
  SotBlock, BrollBlock, ServiceBlock, NoteBlock, BinBlock,
];
