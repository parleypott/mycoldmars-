import scriptData from './palau2-blocks.json';

// PALAU V2 episode config — the second Palau script pass, driving the SHARED WP engine
// (../burma-script/src). Mirrors palau-script/config.js exactly, with its OWN
// `script_palau2_*` storage namespace + cloud project row ('palau2') so V1 and V2 can never
// collide in localStorage or in the cloud.
export const PALAU2 = {
  id: 'palau2',
  title: scriptData.title || 'Palau V2 — The Human Element',
  favicon: '../burma-script/favicon.svg',
  wordmark: 'WP·02·V2',
  figLabel: 'fig.04 — REEF RACK V2',
  recoverPrefix: 'palau2-recovered',
  // CLOUD-BACKED: syncs to the shared per-project endpoint like every other script. First load
  // keep-locals and seeds the cloud from this device (the engine's keep-local rule protects the
  // local doc throughout).
  localOnly: false,
  accent: '#0c7d8c', // ocean teal (same reef palette as V1)
  days: [1, 2, 3, 4, 5, 6, 7], // Palau shoot spans 7 days — DAY 4-7 timecodes are real
  sequences: [],
  // Same six Palau genres. ground's `head` additionally recognizes V2's "INQ n" chapter labels
  // so those stay true chapters instead of being demoted to scenes by the reclassifier.
  genres: [
    { id: 'cold_open', label: 'COLD OPEN', color: '#b0431f', head: 'COLD\\s*OPEN' },
    { id: 'map',       label: 'MAP',       color: '#2f6fb0', head: 'LOOK\\s*AT\\s*(THIS|THE)\\s*MAP|MAP\\s*ROOM|LATM' },
    { id: 'explainer', label: 'EXPLAINER', color: '#7a5cc0', head: 'EXPLAINER|EX\\s*\\d' },
    { id: 'ground',    label: 'GROUND',    color: '#1f8a72', head: 'GROUND|GR\\s*\\d|INQ' },
    { id: 'montage',   label: 'MONTAGE',   color: '#c2491a', head: 'MONTAGE|HEPTAPODS' },
    { id: 'ending',    label: 'ENDING',    color: '#2a2a28', head: 'ENDING|EPILOGUE|OUTRO' },
    { id: 'other',     label: '',          head: null },
  ],
  // Color legend as filterable flavors. ids match the `flavor` values in palau2-blocks.json.
  // V2 adds Johnny's gold ("Im marking b roll i like in gold") + a yellow highlight to V1's pair.
  flavors: [
    { id: 'purple', label: 'ANIMATION',     color: '#7a5cc0' },
    { id: 'pink',   label: 'STRAGGLER',     color: '#e0608f' },
    { id: 'gold',   label: 'B-ROLL I LIKE', color: '#c9a227' },
    { id: 'yellow', label: 'HIGHLIGHT',     color: '#e0b400' },
  ],
  blocksData: scriptData.blocks || [],
  // Engine feature flags — SAME set Palau uses, so V2 behaves exactly like V1.
  features: {
    chipChrome: true,                  // blocks.js — chip-style block chrome
    chapterFrames: true,               // chapter-frames.js — chapter frame decorations + sidebar
    rowDragReorder: true,              // table.js — row drag-to-reorder grip
    convertMenu: true,                 // convert-menu.js — right-click convert-selection menu
    archiveOwnLine: true,              // slash-menu.js + direction-chip.js — /archive pops its own indented line
    dayFold: true,                     // day-fold.js — fold literal "DAY N" preceding a chip
    sequencePicker: true,              // marks.js — right-click chip menu picks SEQUENCE (not DAY)
    timecodeChips: true,               // marks.js — typed/pasted timecode self-chips + retro-convert (presentation)
    transcriptDrop: true,             // transcript-drop.js — drop/paste a transcript soundbite → timecode chips + ON CAM quote row
    palauTimecodes: true,              // document-builder.js — 3-part/bracket timecodes, bundled-day strip, seq context
    inlineSotName: true,               // document-builder.js — SOT sequence name bold INLINE in body
    normalizeTableRows: true,          // document-builder.js — split stacked full-width rows on load
    rebuildFromSourceWhenPristine: true, // migrate-doc.js — rebuild doc from source blocks when byte-pristine
    collab: true,                      // collab.js — real-time co-editing (Liveblocks + Yjs, room `script-palau2`)
  },
  storage: {
    DOC: 'script_palau2_doc_v1',
    DOC_VER: 'script_palau2_doc_ver_v1',
    MIGRATED: 'script_palau2_doc_migrated_v1',
    BLOCKS: 'script_palau2_blocks_v1',
    CTRL: 'script_palau2_controls_v1',
    WORKSHOP: 'script_palau2_workshop_v1',
    WS_WIDTH: 'script_palau2_workshop_width_v1',
    ROLES: 'script_palau2_roles_v1',
    WRITE_TOKEN: 'script_palau2_write_token_v1',
    DISMISSED: 'script_palau2_recovery_dismissed_v1',
  },
  // The generalized per-project doc endpoint keyed by project 'palau2' — same login-gated table
  // as every other script.
  cloud: {
    api: '/api/script-doc?project=palau2',
    docId: 'palau2',
    tokenHeader: 'X-Palau-Write-Token',
    // No `tkApi` — the Workshop {TK}/fact-check panel falls back to the engine default.
  },
};
