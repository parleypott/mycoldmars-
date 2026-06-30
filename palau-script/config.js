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
    { id: 'gold',   label: 'LIKED B-ROLL', color: '#d9a400' },
    { id: 'purple', label: 'ANIMATION',    color: '#7a5cc0' },
    { id: 'pink',   label: 'STRAGGLER',    color: '#e0608f' },
    { id: 'yellow', label: 'KEY LINE',     color: '#e8b400' },
  ],
  blocksData: scriptData.blocks || [],
  storage: {
    DOC: 'script_palau_doc_v1',
    DOC_VER: 'script_palau_doc_ver_v1',
    MIGRATED: 'script_palau_doc_migrated_v2',
    BLOCKS: 'script_palau_blocks_v1',
    CTRL: 'script_palau_controls_v1',
    WORKSHOP: 'script_palau_workshop_v1',
    WS_WIDTH: 'script_palau_workshop_width_v1',
    WRITE_TOKEN: 'script_palau_write_token_v1',
    DISMISSED: 'script_palau_recovery_dismissed_v1',
  },
  // CLOUD DELIBERATELY LOCAL-FIRST ONLY for now. The shared /api/burma-script-doc endpoint hardcodes
  // DOC_ID='wp01-burma' and ignores docId, so any write there would CLOBBER Burma's cloud row. Until a
  // per-episode endpoint exists, Palau points at an inert same-origin path that 404s — the existing
  // "table missing / API unreachable" offline machinery handles it gracefully (amber "cloud offline"
  // pill), and local-first storage remains the data-loss-proof source of truth. TODO: real palau cloud.
  cloud: {
    api: '/api/__palau_cloud_disabled',
    docId: 'palau',
    tokenHeader: 'X-Palau-Write-Token',
  },
};
