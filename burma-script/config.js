import scriptData from './sample-blocks.json';
import { DAY_SEQUENCES } from './schema.ts';

export const BURMA = {
  id: 'burma',
  title: scriptData.title || 'Burma — The Human Element',
  favicon: './favicon.svg',
  wordmark: 'WP·01',
  figLabel: 'fig.03 — CARTRIDGE RACK',
  recoverPrefix: 'burma-recovered',
  accent: '#ff5b1f',
  days: [1, 2, 3],
  sequences: DAY_SEQUENCES,
  genres: [
    { id: 'coldopen', label: 'HISTORY', head: 'COLD\\s*OPEN' },
    { id: 'history', label: 'HISTORY', head: 'HISTORY' },
    { id: 'ground', label: 'GROUND', head: 'GROUND' },
    { id: 'inquiry', label: 'GROUND', head: 'INQUIRY' },
    { id: 'latm', label: 'GROUND', head: 'LATM' },
    { id: 'other', label: '', head: null },
  ],
  flavors: [],
  // Engine feature flags (read via episodeFlag in episode-config.js). Burma adopts the SAFE visual
  // dials of the shared doctrine: chipChrome hides the REC pill + VO/DIRECTION labels and gives the
  // calm chip / gridline / split-row treatment; chapterFrames gives the light book-header chapters;
  // dayFold is a harmless render de-dupe. LEFT OFF: the interaction dials (rowDragReorder, convertMenu,
  // archiveOwnLine, sequencePicker) and — critically — every DATA-touching flag (palauTimecodes,
  // inlineSotName, normalizeTableRows, rebuildFromSourceWhenPristine), which would reinterpret Burma's
  // saved doc and must stay false.
  features: { chipChrome: true, chapterFrames: true, dayFold: true },
  blocksData: scriptData.blocks || [],
  storage: {
    DOC: 'wp01_burma_doc_v1',
    DOC_VER: 'wp01_burma_doc_ver_v1',
    MIGRATED: 'wp01_burma_doc_migrated_v2',
    BLOCKS: 'wp01_burma_blocks_v1',
    CTRL: 'wp01.controls.v1',
    WORKSHOP: 'wp01_burma_workshop_v1',
    WS_WIDTH: 'wp01_burma_workshop_width_v1',
    WRITE_TOKEN: 'wp01_burma_write_token_v1',
    DISMISSED: 'wp01.recovery.dismissed.v1',
  },
  cloud: {
    api: '/api/burma-script-doc',
    docId: 'wp01-burma',
    tokenHeader: 'X-Burma-Write-Token',
    // Workshop {TK}/fact-check endpoint. The engine falls back to '/api/burma-tk' when an
    // episode omits this, but Burma pins it explicitly.
    tkApi: '/api/burma-tk',
  },
};
