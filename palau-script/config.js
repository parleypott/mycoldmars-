import scriptData from './palau-blocks.json';

// PALAU episode config — drives the SHARED WP engine (../burma-script/src). Burma's config lives at
// burma-script/config.js and pins its legacy storage keys; Palau gets its own `script_palau_*`
// namespace so the two episodes can never collide in localStorage or in the cloud row.
export const PALAU = {
  id: 'palau',
  title: scriptData.title || 'Palau — The Human Element',
  favicon: '../burma-script/favicon.svg',
  wordmark: 'WP·02',
  figLabel: 'fig.04 — REEF RACK',
  recoverPrefix: 'palau-recovered',
  // CLOUD-BACKED (Enterprise Wave 2): Palau now syncs to the shared per-project endpoint like every
  // other script. It had no canonical cloud doc before (local-only), so the first load keep-locals and
  // seeds the cloud from this device — the engine's keep-local rule protects the local doc throughout.
  localOnly: false,
  accent: '#0c7d8c', // ocean teal
  days: [1, 2, 3, 4, 5, 6, 7], // Palau shoot spans 7 days
  sequences: [],
  // Six Palau genres. `head` feeds the chapter-reclassifier regex; `color` tints the chapter cap
  // (consumed by palau-script/episode.css). Burma genres carry no color, so Burma is unaffected.
  genres: [
    { id: 'cold_open', label: 'COLD OPEN', color: '#b0431f', head: 'COLD\\s*OPEN' },
    { id: 'map',       label: 'MAP',       color: '#2f6fb0', head: 'LOOK\\s*AT\\s*(THIS|THE)\\s*MAP|MAP\\s*ROOM|LATM' },
    { id: 'explainer', label: 'EXPLAINER', color: '#7a5cc0', head: 'EXPLAINER|EX\\s*\\d' },
    { id: 'ground',    label: 'GROUND',    color: '#1f8a72', head: 'GROUND|GR\\s*\\d' },
    { id: 'montage',   label: 'MONTAGE',   color: '#c2491a', head: 'MONTAGE|HEPTAPODS' },
    { id: 'ending',    label: 'ENDING',    color: '#2a2a28', head: 'ENDING|EPILOGUE|OUTRO' },
    { id: 'other',     label: '',          head: null },
  ],
  // Color legend as filterable flavors. ids match the `flavor` values in palau-blocks.json.
  flavors: [
    { id: 'purple', label: 'ANIMATION',    color: '#7a5cc0' },
    { id: 'pink',   label: 'STRAGGLER',    color: '#e0608f' },
  ],
  blocksData: scriptData.blocks || [],
  // Engine feature flags (read via episodeFlag in episode-config.js). These replace the old
  // hardcoded `id === 'palau'` gates in the shared engine — every Palau-era affordance is ON
  // here so Palau behaves exactly as it did before the flag system. Burma sets none of these.
  features: {
    chipChrome: true,                  // blocks.js — chip-style block chrome
    chapterFrames: true,               // chapter-frames.js — chapter frame decorations + sidebar
    rowDragReorder: true,              // table.js — row drag-to-reorder grip
    convertMenu: true,                 // convert-menu.js — right-click convert-selection menu
    archiveOwnLine: true,              // slash-menu.js + direction-chip.js — /archive pops its own indented line
    dayFold: true,                     // day-fold.js — fold literal "DAY N" preceding a chip
    sequencePicker: true,              // marks.js — right-click chip menu picks SEQUENCE (not DAY)
    palauTimecodes: true,              // document-builder.js — 3-part/bracket timecodes, bundled-day strip, seq context
    inlineSotName: true,               // document-builder.js — SOT sequence name bold INLINE in body
    normalizeTableRows: true,          // document-builder.js — split stacked full-width rows on load
    rebuildFromSourceWhenPristine: true, // migrate-doc.js — rebuild doc from source blocks when byte-pristine
    collab: true,                      // collab.js — real-time co-editing (Liveblocks + Yjs, room `script-palau`)
  },
  storage: {
    DOC: 'script_palau_doc_v2',
    DOC_VER: 'script_palau_doc_ver_v2',
    MIGRATED: 'script_palau_doc_migrated_v3',
    BLOCKS: 'script_palau_blocks_v2',
    CTRL: 'script_palau_controls_v1',
    WORKSHOP: 'script_palau_workshop_v1',
    WS_WIDTH: 'script_palau_workshop_width_v1',
    WRITE_TOKEN: 'script_palau_write_token_v1',
    DISMISSED: 'script_palau_recovery_dismissed_v1',
  },
  // CLOUD (Enterprise Wave 2): the generalized per-project endpoint keyed by project 'palau' — the
  // same login-gated table as every other script. Replaces the old inert '/api/__palau_cloud_disabled'
  // 404 path now that a real multi-project endpoint exists.
  cloud: {
    api: '/api/script-doc?project=palau',
    docId: 'palau',
    tokenHeader: 'X-Palau-Write-Token',
    // No `tkApi` set — the Workshop {TK}/fact-check panel falls back to the engine default
    // ('/api/burma-tk'), which is what Palau has always hit.
  },
};
